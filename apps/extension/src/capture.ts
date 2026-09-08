import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_INBOX_ASSETS,
  type CreateInboxInput,
  type InboxItem,
} from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { idempotencyKeyForUrl } from './canonical.js';
import {
  extensionLoginUrl,
  feedbackView,
  inboxInputFromCapture,
  inboxListUrl,
  inboxReaderUrl,
  selectionInputFromCapture,
  taskNotesFromCapture,
  type SaveFeedbackEvent,
  type SaveKind,
} from './capture-helpers.js';
import { getClient, requireAuth } from './client.js';
import { WEB_URL } from './config.js';
import { clip, escapeParagraph, hostnameOf, isHttpUrl } from './html.js';
import { copy } from './i18n.js';
import {
  MIN_IMAGE_BYTES,
  bytesToArrayBuffer,
  isTrackingPixel,
  normalizeMime,
  rewriteExtractedImageSrcs,
  shouldConvertImage,
} from './images.js';
import type { CapturePayload, PopupMode } from './messages.js';
import { convertInOffscreen, parseInOffscreen } from './offscreen.js';
import { collectPagePayload, fetchImagesInPage, showInPageToast } from './page-scripts.js';
import { titleForMode } from './popup-state.js';

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

export interface CaptureOutcome {
  kind: SaveKind;
  id: string;
}

type Announce = (
  event: SaveFeedbackEvent,
  action?: { label: string; url: string },
) => Promise<void>;

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

function outcomeAction(outcome: CaptureOutcome): { label: string; url: string } {
  const url = outcome.kind === 'task' ? inboxListUrl(WEB_URL) : inboxReaderUrl(WEB_URL, outcome.id);
  return { label: copy.toastOpen, url };
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

async function collectFromTab(tabId: number) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectPagePayload,
  });
  const first = results[0]?.result;
  if (first === undefined) {
    throw new Error(copy.toastFailed);
  }
  return first;
}

interface FetchedImage {
  src: string;
  mime: string;
  blob: Blob;
}

async function fetchOneFromSw(src: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(src, { credentials: 'omit' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < MIN_IMAGE_BYTES || buf.byteLength > MAX_IMAGE_BYTES) return null;
    const header = res.headers.get('content-type') ?? '';
    const mime = normalizeMime(header, buf);
    return {
      src,
      mime: mime ?? header.split(';')[0]?.trim() ?? '',
      blob: new Blob([buf], { type: mime ?? '' }),
    };
  } catch {
    return null;
  }
}

async function fetchFromPage(tabId: number, urls: string[]): Promise<FetchedImage[]> {
  if (urls.length === 0) return [];
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: fetchImagesInPage,
      args: [urls, MAX_IMAGE_BYTES, MIN_IMAGE_BYTES],
    });
    const rows = results[0]?.result ?? [];
    const out: FetchedImage[] = [];
    for (const row of rows) {
      const bytes = Uint8Array.from(row.data);
      const mime = normalizeMime(row.mime, bytes.buffer);
      out.push({
        src: row.src,
        mime: mime ?? row.mime.split(';')[0]?.trim() ?? '',
        blob: new Blob([bytesToArrayBuffer(bytes)], { type: mime ?? row.mime }),
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function gatherImages(tabId: number | undefined, srcs: string[]): Promise<FetchedImage[]> {
  const wanted = srcs.slice(0, MAX_INBOX_ASSETS);
  const found: FetchedImage[] = [];
  const missing: string[] = [];
  for (const src of wanted) {
    const fromSw = await fetchOneFromSw(src);
    if (fromSw !== null) found.push(fromSw);
    else missing.push(src);
  }
  if (tabId !== undefined && missing.length > 0 && found.length < MAX_INBOX_ASSETS) {
    const fromPage = await fetchFromPage(tabId, missing);
    found.push(...fromPage);
  }
  return found.slice(0, MAX_INBOX_ASSETS);
}

async function prepareUpload(image: FetchedImage): Promise<FetchedImage | null> {
  let mime = image.mime === 'image/jpg' ? 'image/jpeg' : image.mime;
  let blob = image.blob;
  if (shouldConvertImage(mime === '' ? null : mime)) {
    try {
      const converted = await convertInOffscreen(blob);
      mime = converted.mime;
      blob = converted.blob;
    } catch {
      // Fall through and try the original bytes if the MIME is already allowed.
    }
  }
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(mime)) return null;
  if (blob.size < MIN_IMAGE_BYTES || blob.size > MAX_IMAGE_BYTES) return null;
  return { src: image.src, mime, blob };
}

async function rehostImages(
  item: InboxItem,
  images: FetchedImage[],
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<{ item: InboxItem; failed: number }> {
  if (images.length === 0) return { item, failed: 0 };
  if (item.assets.length > 0) return { item, failed: 0 };
  const assets: Array<{ attachmentId: string; originalSrc: string; sortOrder: number }> = [];
  const client = getClient();
  let failed = 0;
  for (let i = 0; i < images.length; i += 1) {
    const raw = images[i];
    if (raw === undefined) continue;
    const prepared = await prepareUpload(raw);
    if (prepared === null) {
      failed += 1;
      await onProgress?.(i + 1, images.length);
      continue;
    }
    try {
      const uploaded = await client.upload({
        file: prepared.blob,
        mime: prepared.mime,
        size: prepared.blob.size,
      });
      assets.push({
        attachmentId: uploaded.id,
        originalSrc: prepared.src,
        sortOrder: assets.length,
      });
    } catch {
      failed += 1;
    }
    await onProgress?.(i + 1, images.length);
  }
  if (assets.length === 0) return { item, failed };
  const rewritten = rewriteExtractedImageSrcs(
    item.extractedHtml ?? '',
    assets.map((asset) => ({
      originalSrc: asset.originalSrc,
      uploadPath: `/api/v1/uploads/${asset.attachmentId}`,
    })),
  );
  if (rewritten !== '' && rewritten !== item.extractedHtml) {
    try {
      await client.patchInbox(item.id, { extractedHtml: rewritten });
    } catch {
      // Reader can still map originalSrc via assets.
    }
  }
  return { item: await client.patchInboxAssets(item.id, { assets }), failed };
}

async function announceSaved(report: Announce, outcome: CaptureOutcome) {
  await report({ type: 'saved', kind: outcome.kind }, outcomeAction(outcome));
}

async function rehostWithFeedback(
  report: Announce,
  item: InboxItem,
  images: FetchedImage[],
  outcome: CaptureOutcome,
): Promise<void> {
  if (images.length === 0) return;
  const { failed } = await rehostImages(item, images, async (done, total) => {
    await report({ type: 'upload', done, total });
  });
  await report({ type: 'imagesDone', failed }, outcomeAction(outcome));
}

async function createExtensionItem(
  input: CreateInboxInput,
): Promise<{ item: InboxItem; created: boolean }> {
  const originalUrl = input.originalUrl;
  if (originalUrl === undefined || originalUrl === null) {
    throw new Error(copy.toastRestricted);
  }
  const { key } = await idempotencyKeyForUrl(originalUrl);
  return getClient().createInboxResult({ ...input, source: 'extension' }, key);
}

async function inboxListId(): Promise<string> {
  const lists = await getClient().listLists();
  const inbox = lists.items.find((list) => list.kind === 'inbox');
  if (inbox === undefined) throw new Error(copy.toastFailed);
  return inbox.id;
}

async function savePage(
  tab: chrome.tabs.Tab,
  selectionOnly: boolean,
  report: Announce,
): Promise<CaptureOutcome> {
  const tabId = tab.id;
  if (tabId === undefined) throw new Error(copy.toastFailed);
  const page = await collectFromTab(tabId);
  const originalUrl = isHttpUrl(page.url) ? page.url : tab.url;
  if (originalUrl === undefined || !isHttpUrl(originalUrl)) {
    throw new Error(copy.toastRestricted);
  }

  if (selectionOnly) {
    const selection = page.selection.trim();
    if (selection === '') throw new Error(copy.toastFailed);
    const title = clip(selection, 80) ?? originalUrl;
    const result = await createExtensionItem({
      title,
      originalUrl,
      extractedText: clip(selection, 2 * 1024 * 1024),
      extractedHtml: escapeParagraph(selection),
      source: 'extension',
    });
    const outcome = { kind: result.created ? 'created' : 'existing', id: result.item.id } as const;
    await announceSaved(report, outcome);
    return outcome;
  }

  let parsed;
  try {
    parsed = await parseInOffscreen(page.outerHTML, originalUrl);
  } catch {
    parsed = {
      title: clip(page.title, 500) ?? hostnameOf(originalUrl) ?? originalUrl,
      extractedHtml: null,
      extractedText: null,
      excerpt: null,
      byline: null,
      siteName: null,
      imageSrcs: [] as string[],
    };
  }
  const result = await createExtensionItem({
    title: parsed.title,
    originalUrl,
    extractedText: parsed.extractedText,
    extractedHtml: parsed.extractedHtml,
    excerpt: parsed.excerpt,
    byline: parsed.byline,
    siteName: parsed.siteName,
    source: 'extension',
  });
  const outcome = { kind: result.created ? 'created' : 'existing', id: result.item.id } as const;
  await announceSaved(report, outcome);
  if (result.created) {
    const images = await gatherImages(tabId, parsed.imageSrcs);
    await rehostWithFeedback(report, result.item, images, outcome);
  }
  return outcome;
}

async function saveLink(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  report: Announce,
): Promise<CaptureOutcome> {
  const href = info.linkUrl;
  if (href === undefined || !isHttpUrl(href)) throw new Error(copy.toastRestricted);
  const title = clip(info.selectionText, 80) ?? clip(tab?.title, 500) ?? hostnameOf(href) ?? href;
  const result = await createExtensionItem({
    title,
    originalUrl: href,
    excerpt: tab?.url && isHttpUrl(tab.url) ? tab.url : null,
    source: 'extension',
  });
  const outcome = { kind: result.created ? 'created' : 'existing', id: result.item.id } as const;
  await announceSaved(report, outcome);
  return outcome;
}

async function saveImage(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  report: Announce,
): Promise<CaptureOutcome> {
  const pageUrl = info.pageUrl ?? tab?.url;
  if (pageUrl === undefined || !isHttpUrl(pageUrl)) throw new Error(copy.toastRestricted);
  const src = info.srcUrl;
  const title =
    clip(info.selectionText, 80) ?? clip(tab?.title, 500) ?? hostnameOf(pageUrl) ?? pageUrl;
  const result = await createExtensionItem({
    title,
    originalUrl: pageUrl,
    excerpt: src ?? null,
    source: 'extension',
  });
  const outcome = { kind: result.created ? 'created' : 'existing', id: result.item.id } as const;
  await announceSaved(report, outcome);
  if (result.created && src !== undefined && !isTrackingPixel({ src })) {
    const images = await gatherImages(tab?.id, [src]);
    await rehostWithFeedback(report, result.item, images, outcome);
  }
  return outcome;
}

async function saveTask(
  info: chrome.contextMenus.OnClickData | undefined,
  tab: chrome.tabs.Tab,
  report: Announce,
): Promise<CaptureOutcome> {
  const link = info?.linkUrl;
  const pageUrl = (link !== undefined && isHttpUrl(link) ? link : undefined) ?? tab.url;
  if (pageUrl === undefined || !isHttpUrl(pageUrl)) throw new Error(copy.toastRestricted);
  const selection = info?.selectionText?.trim() ?? '';
  const title = clip(selection, 80) ?? clip(tab.title, 500) ?? hostnameOf(pageUrl) ?? pageUrl;
  const task = await getClient().createTask({
    title,
    listId: await inboxListId(),
    notes: taskNotesFromCapture(pageUrl, selection),
    timeBucket: 'anytime',
  });
  const outcome = { kind: 'task' as const, id: task.id };
  await announceSaved(report, outcome);
  return outcome;
}

export async function extractCapture(tab: chrome.tabs.Tab): Promise<CapturePayload> {
  const tabId = tab.id;
  if (tabId === undefined) throw new Error(copy.toastFailed);
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
    selection: page.selection.trim(),
    tabId,
  };
  try {
    const parsed = await parseInOffscreen(page.outerHTML, originalUrl);
    return {
      ...payload,
      title: parsed.title,
      extractedText: parsed.extractedText,
      extractedHtml: parsed.extractedHtml,
      excerpt: parsed.excerpt,
      byline: parsed.byline,
      siteName: parsed.siteName,
      imageSrcs: parsed.imageSrcs,
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

export interface CommitResult {
  outcome: CaptureOutcome;
  failed: number;
}

export async function commitCapture(input: {
  capture: CapturePayload;
  title: string;
  note: string;
  mode: PopupMode;
  listId?: string;
  onCreated?: (outcome: CaptureOutcome) => Promise<void> | void;
  onProgress?: (done: number, total: number) => Promise<void> | void;
}): Promise<CommitResult> {
  const { capture } = input;
  const title = input.title.trim() === '' ? titleForMode(capture, input.mode) : input.title.trim();
  if (input.mode === 'task') {
    const task = await getClient().createTask({
      title,
      listId: input.listId ?? (await inboxListId()),
      notes: taskNotesFromCapture(capture.originalUrl, input.note || capture.selection),
      timeBucket: 'anytime',
    });
    const outcome: CaptureOutcome = { kind: 'task', id: task.id };
    await input.onCreated?.(outcome);
    return { outcome, failed: 0 };
  }
  const base =
    input.mode === 'selection'
      ? selectionInputFromCapture(capture, title)
      : inboxInputFromCapture(capture, title, input.note);
  const result = await createExtensionItem(base);
  const outcome: CaptureOutcome = {
    kind: result.created ? 'created' : 'existing',
    id: result.item.id,
  };
  await input.onCreated?.(outcome);
  if (result.created && input.mode === 'article') {
    const images = await gatherImages(capture.tabId ?? undefined, capture.imageSrcs);
    const { failed } = await rehostImages(result.item, images, input.onProgress);
    return { outcome, failed };
  }
  return { outcome, failed: 0 };
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
