import { htmlToArticleDoc } from '@vital/article-doc';
import { partSizeFor, totalPartsFor, type CreateInboxInput, type InboxItem } from '@vital/dto';
import { idempotencyKeyForUrl } from '../canonical.js';
import {
  inboxInputFromCapture,
  selectionInputFromCapture,
  taskNotesFromCapture,
} from '../capture-helpers.js';
import { getClient } from '../client.js';
import { fileKindOf, fileModeFromResponse, type DirectFile } from '../file-kind.js';
import { clip, hostnameOf, isHttpUrl } from '../html.js';
import { copy } from '../i18n.js';
import { isTrackingPixel } from '../images.js';
import type { CapturePayload, PopupMode } from '../messages.js';
import { parseInOffscreen } from '../offscreen.js';
import type { ParsedArticle } from '../parse-article.js';
import { collectPagePayload } from '../page-scripts.js';
import { titleForMode } from '../popup-state.js';
import {
  gatherImages,
  itemNeedingRehost,
  rehostDirectFile,
  rehostImages,
  rehostWithFeedback,
} from './image-pipeline.js';
import {
  announceSaved,
  outcomeAction,
  type Announce,
  type CaptureOutcome,
  type CommitResult,
} from './types.js';

function emptyParsed(title: string): ParsedArticle {
  return {
    title,
    extractedHtml: null,
    extractedText: null,
    excerpt: null,
    byline: null,
    siteName: null,
    imageSrcs: [],
  };
}

export async function collectFromTab(tabId: number) {
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

export async function savePage(
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
      source: 'extension',
    });
    const outcome = { kind: result.created ? 'created' : 'existing', id: result.item.id } as const;
    await announceSaved(report, outcome);
    return outcome;
  }

  let parsed: ParsedArticle;
  try {
    parsed = await parseInOffscreen(page.outerHTML, originalUrl, 'article');
  } catch {
    parsed = emptyParsed(clip(page.title, 500) ?? hostnameOf(originalUrl) ?? originalUrl);
  }
  const result = await createExtensionItem({
    title: parsed.title,
    originalUrl,
    extractedText: parsed.extractedText,
    contentJson:
      parsed.extractedHtml !== null && parsed.extractedHtml !== ''
        ? htmlToArticleDoc(parsed.extractedHtml)
        : null,
    excerpt: parsed.excerpt,
    byline: parsed.byline,
    siteName: parsed.siteName,
    source: 'extension',
  });
  const outcome = { kind: result.created ? 'created' : 'existing', id: result.item.id } as const;
  await announceSaved(report, outcome);
  const rehostItem = await itemNeedingRehost(result.item, result.created);
  if (rehostItem !== null) {
    const images = await gatherImages(tabId, parsed.imageSrcs);
    await rehostWithFeedback(report, rehostItem, images, outcome);
  }
  return outcome;
}

/** HEAD-probe a candidate direct link; null → not a rehostable file. */
export async function probeDirectFile(url: string): Promise<DirectFile | null> {
  try {
    const res = await fetch(url, { method: 'HEAD', credentials: 'omit' });
    if (!res.ok) return null;
    const len = res.headers.get('content-length');
    // Number("...") can be NaN; fileModeFromResponse rejects non-finite sizes.
    const n = len === null ? null : Number(len);
    return fileModeFromResponse(url, res.headers.get('content-type') ?? '', n);
  } catch {
    return null; // CORS or network → article mode
  }
}

export function fileNameFromUrl(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return name === '' ? url : name;
  } catch {
    return url;
  }
}

async function saveDirectFile(file: DirectFile, report: Announce): Promise<CaptureOutcome> {
  const result = await createExtensionItem({
    title: fileNameFromUrl(file.url),
    originalUrl: file.url,
    source: 'extension',
  });
  const outcome: CaptureOutcome = {
    kind: result.created ? 'created' : 'existing',
    id: result.item.id,
  };
  await announceSaved(report, outcome);
  if (!result.created) return outcome;
  const totalParts = totalPartsFor(file.size);
  const rehosted = await rehostDirectFile(file, (loaded) => {
    const done = Math.min(totalParts, Math.ceil(loaded / partSizeFor(file.size)));
    return report({ type: 'upload', done, total: totalParts });
  });
  let failed = rehosted.attachmentId !== null ? 0 : 1;
  if (rehosted.attachmentId !== null) {
    try {
      await getClient().patchInboxAssets(result.item.id, {
        assets: [{ attachmentId: rehosted.attachmentId, originalSrc: file.url, sortOrder: 0 }],
      });
    } catch {
      failed = 1; // item is saved; only the asset attach failed
    }
  }
  await report({ type: 'imagesDone', failed }, outcomeAction(outcome));
  return outcome;
}

export async function saveLink(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
  report: Announce,
): Promise<CaptureOutcome> {
  const href = info.linkUrl;
  if (href === undefined || !isHttpUrl(href)) throw new Error(copy.toastRestricted);
  if (fileKindOf(href) !== null) {
    const direct = await probeDirectFile(href);
    if (direct !== null) return saveDirectFile(direct, report);
  }
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

export async function saveImage(
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
  if (src !== undefined && !isTrackingPixel({ src })) {
    const rehostItem = await itemNeedingRehost(result.item, result.created);
    if (rehostItem !== null) {
      const images = await gatherImages(tab?.id, [src]);
      await rehostWithFeedback(report, rehostItem, images, outcome);
    }
  }
  return outcome;
}

export async function saveTask(
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
  });
  const outcome = { kind: 'task' as const, id: task.id };
  await announceSaved(report, outcome);
  return outcome;
}

/** Page parse for commit: use the popup cache, else offscreen, else empty. */
export async function pageParsedForCommit(
  capture: CapturePayload,
  cached: ParsedArticle | undefined,
  parse: (
    html: string,
    url: string,
    mode: 'page',
  ) => Promise<ParsedArticle> = parseInOffscreen,
): Promise<ParsedArticle> {
  if (cached !== undefined) return cached;
  if (capture.rawHtml === null) return emptyParsed(capture.title);
  return parse(capture.rawHtml, capture.originalUrl, 'page');
}

export async function commitCapture(input: {
  capture: CapturePayload;
  title: string;
  note: string;
  mode: PopupMode;
  listId?: string;
  pageParsed?: ParsedArticle;
  onCreated?: (outcome: CaptureOutcome) => Promise<void> | void;
  onProgress?: (done: number, total: number) => Promise<void> | void;
}): Promise<CommitResult> {
  const { capture } = input;
  const pageParsed =
    input.mode === 'page'
      ? await pageParsedForCommit(capture, input.pageParsed)
      : undefined;
  const title =
    input.title.trim() === ''
      ? titleForMode(capture, input.mode, pageParsed)
      : input.title.trim();
  if (input.mode === 'file' && capture.file !== null) {
    const file = capture.file;
    const result = await createExtensionItem({ title, originalUrl: file.url, source: 'extension' });
    const outcome: CaptureOutcome = {
      kind: result.created ? 'created' : 'existing',
      id: result.item.id,
    };
    await input.onCreated?.(outcome);
    let failed = 0;
    if (result.created) {
      const totalParts = totalPartsFor(file.size);
      const rehosted = await rehostDirectFile(file, (loaded) => {
        // Convert byte progress to part counts for the n/N progress UI.
        const done = Math.min(totalParts, Math.ceil(loaded / partSizeFor(file.size)));
        return input.onProgress?.(done, totalParts);
      });
      if (rehosted.attachmentId !== null) {
        try {
          await getClient().patchInboxAssets(result.item.id, {
            assets: [
              { attachmentId: rehosted.attachmentId, originalSrc: file.url, sortOrder: 0 },
            ],
          });
        } catch {
          failed = 1; // item is saved; only the asset attach failed
        }
      } else {
        failed = 1;
      }
    }
    return { outcome, failed };
  }
  if (input.mode === 'task') {
    const task = await getClient().createTask({
      title,
      listId: input.listId ?? (await inboxListId()),
      notes: taskNotesFromCapture(capture.originalUrl, input.note || capture.selection),
    });
    const outcome: CaptureOutcome = { kind: 'task', id: task.id };
    await input.onCreated?.(outcome);
    return { outcome, failed: 0 };
  }
  const base =
    input.mode === 'selection'
      ? selectionInputFromCapture(capture, title)
      : inboxInputFromCapture(capture, title, input.note, pageParsed);
  const result = await createExtensionItem(base);
  const outcome: CaptureOutcome = {
    kind: result.created ? 'created' : 'existing',
    id: result.item.id,
  };
  await input.onCreated?.(outcome);
  if (input.mode === 'article' || input.mode === 'page') {
    const rehostItem = await itemNeedingRehost(result.item, result.created);
    if (rehostItem !== null) {
      const srcs = input.mode === 'page' ? (pageParsed?.imageSrcs ?? []) : capture.imageSrcs;
      const images = await gatherImages(capture.tabId ?? undefined, srcs);
      const { failed } = await rehostImages(rehostItem, images, input.onProgress);
      return { outcome, failed };
    }
  }
  return { outcome, failed: 0 };
}
