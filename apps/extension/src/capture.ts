import { ApiError } from '@vital/api-client';
import { MAX_EXTRACT_HTML_BYTES } from '@vital/dto';
import {
  collectFromTab,
  fileNameFromUrl,
  probeDirectFile,
  saveImage,
  saveLink,
  savePage,
  saveTask,
} from './capture/save-flows.js';
import type { Announce } from './capture/types.js';
import {
  extensionLoginUrl,
  feedbackView,
  inboxListUrl,
  type SaveFeedbackEvent,
} from './capture-helpers.js';
import { requireAuth } from './client.js';
import { WEB_URL } from './config.js';
import { fileKindOf } from './file-kind.js';
import { clip, hostnameOf, isHttpUrl } from './html.js';
import { copy } from './i18n.js';
import { requestImageHostAccess } from './image-hosts.js';
import type { CapturePayload } from './messages.js';
import { parseInOffscreen } from './offscreen.js';
import { showInPageToast } from './page-scripts.js';

export { commitCapture, pageParsedForCommit } from './capture/save-flows.js';
export type { CaptureOutcome, CommitResult } from './capture/types.js';

const MENU = {
  page: 'vital-save-page',
  link: 'vital-save-link',
  selection: 'vital-save-selection',
  image: 'vital-save-image',
  task: 'vital-save-task',
  edit: 'vital-save-edit',
} as const;

export const COMMAND = {
  savePage: 'save-page',
  saveEdit: 'save-and-edit',
} as const;

export async function registerMenus(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU.page, title: copy.menuPage, contexts: ['page'] });
  chrome.contextMenus.create({ id: MENU.link, title: copy.menuLink, contexts: ['link'] });
  chrome.contextMenus.create({
    id: MENU.selection,
    title: copy.menuSelection,
    contexts: ['selection'],
  });
  chrome.contextMenus.create({ id: MENU.image, title: copy.menuImage, contexts: ['image'] });
  chrome.contextMenus.create({
    id: MENU.task,
    title: copy.menuSaveTask,
    contexts: ['page', 'selection', 'link'],
  });
  chrome.contextMenus.create({
    id: MENU.edit,
    title: copy.menuSaveEdit,
    contexts: ['page', 'selection'],
  });
}

async function toast(
  tabId: number | undefined,
  text: string,
  action?: { label: string; url: string },
): Promise<boolean> {
  if (tabId === undefined) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: showInPageToast,
      args: [text, action?.label ?? '', action?.url ?? ''],
    });
    return true;
  } catch {
    // chrome:// and other restricted pages cannot show an in-page toast.
    return false;
  }
}

let badgeClearTimer: ReturnType<typeof setTimeout> | undefined;

export async function setBadge(text: string): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text });
    if (text !== '') {
      await chrome.action.setBadgeBackgroundColor({
        color: text === '!' ? '#b42318' : '#111111',
      });
    }
    if (badgeClearTimer !== undefined) clearTimeout(badgeClearTimer);
    if (text === '') return;
    badgeClearTimer = setTimeout(() => {
      void chrome.action.setBadgeText({ text: '' });
    }, 4200);
  } catch {
    // Missing action API in tests / some browsers.
  }
}

async function announce(
  tab: chrome.tabs.Tab | undefined,
  event: SaveFeedbackEvent,
  action?: { label: string; url: string },
): Promise<void> {
  const view = feedbackView(event);
  const shown = await toast(tab?.id, view.text, action);
  if (!shown) await setBadge(view.badge);
}

export async function extractCapture(tab: chrome.tabs.Tab): Promise<CapturePayload> {
  const tabId = tab.id;
  if (tabId === undefined) throw new Error(copy.toastFailed);
  const tabUrl = tab.url ?? '';
  if (isHttpUrl(tabUrl) && fileKindOf(tabUrl) !== null) {
    const direct = await probeDirectFile(tabUrl);
    if (direct !== null) {
      return {
        title: fileNameFromUrl(direct.url),
        originalUrl: direct.url,
        extractedText: null,
        extractedHtml: null,
        excerpt: null,
        byline: null,
        siteName: null,
        imageSrcs: [],
        rawHtml: null,
        selection: '',
        tabId,
        file: direct,
      };
    }
    // .pdf route serving html → fall through to article mode
  }
  const page = await collectFromTab(tabId);
  const originalUrl = isHttpUrl(page.url) ? page.url : tab.url;
  if (originalUrl === undefined || !isHttpUrl(originalUrl)) {
    throw new Error(copy.toastRestricted);
  }
  const payload: CapturePayload = {
    title: clip(page.title, 500) ?? hostnameOf(originalUrl) ?? originalUrl,
    originalUrl,
    extractedText: null,
    extractedHtml: null,
    excerpt: null,
    byline: null,
    siteName: null,
    imageSrcs: [],
    rawHtml: clip(page.outerHTML, MAX_EXTRACT_HTML_BYTES),
    selection: page.selection.trim(),
    tabId,
    file: null,
  };
  try {
    const article = await parseInOffscreen(page.outerHTML, originalUrl, 'article');
    return {
      ...payload,
      title: article.title,
      extractedText: article.extractedText,
      extractedHtml: article.extractedHtml,
      excerpt: article.excerpt,
      byline: article.byline,
      siteName: article.siteName,
      imageSrcs: article.imageSrcs,
    };
  } catch {
    return payload;
  }
}

export async function captureActiveTabPayload(): Promise<CapturePayload> {
  const tab = await activeTab();
  if (tab === undefined) throw new Error(copy.toastFailed);
  return extractCapture(tab);
}

export async function openCapturePopup(): Promise<void> {
  try {
    await chrome.action.openPopup();
  } catch {
    // Popup already open, or the API is policy-disabled: fall back to the web inbox.
    await chrome.tabs.create({ url: inboxListUrl(WEB_URL) });
  }
}

async function promptLogin(tab: chrome.tabs.Tab | undefined): Promise<void> {
  await announce(tab, { type: 'fail', message: copy.toastLogin });
  try {
    await chrome.action.openPopup();
  } catch {
    await chrome.tabs.create({ url: extensionLoginUrl(WEB_URL, chrome.runtime.id) });
  }
}

function failMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message !== '') return err.message;
  return copy.toastFailed;
}

async function withAuth(
  tab: chrome.tabs.Tab | undefined,
  run: (report: Announce) => Promise<void>,
  opts: { saving?: boolean } = {},
): Promise<void> {
  const loggedIn = await requireAuth();
  if (!loggedIn) {
    await promptLogin(tab);
    return;
  }
  const report: Announce = (event, action) => announce(tab, event, action);
  if (opts.saving !== false) await report({ type: 'saving' });
  try {
    await run(report);
  } catch (err) {
    await report({ type: 'fail', message: failMessage(err) });
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

export async function handleActionClick(tab: chrome.tabs.Tab): Promise<void> {
  await requestImageHostAccess();
  await withAuth(tab, async (report) => {
    await savePage(tab, false, report);
  });
}

export async function handleCommand(command: string): Promise<void> {
  const tab = await activeTab();
  if (tab === undefined) return;
  if (command === COMMAND.savePage) {
    await handleActionClick(tab);
    return;
  }
  if (command === COMMAND.saveEdit) {
    await openCapturePopup();
    return;
  }
}

export async function handleContextMenu(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  if (info.menuItemId === MENU.edit) {
    await openCapturePopup();
    return;
  }
  await requestImageHostAccess();
  await withAuth(tab, async (report) => {
    switch (info.menuItemId) {
      case MENU.page:
        if (tab === undefined) throw new Error(copy.toastFailed);
        await savePage(tab, false, report);
        return;
      case MENU.selection:
        if (tab === undefined) throw new Error(copy.toastFailed);
        await savePage(tab, true, report);
        return;
      case MENU.link:
        await saveLink(info, tab, report);
        return;
      case MENU.image:
        await saveImage(info, tab, report);
        return;
      case MENU.task:
        if (tab === undefined) throw new Error(copy.toastFailed);
        await saveTask(info, tab, report);
        return;
      default:
        return;
    }
  });
}
