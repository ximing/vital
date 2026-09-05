import {
  IMAGE_MIME_TYPES,
  MAX_EXTRACT_IMAGE_BYTES,
  MAX_INBOX_ASSETS,
  type CreateInboxInput,
  type InboxItem,
} from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { idempotencyKeyForUrl } from './canonical.js';
import { getClient, requireAuth } from './client.js';
import { PANEL_PATH } from './config.js';
import { clip, escapeParagraph, hostnameOf, isHttpUrl } from './html.js';
import { copy } from './i18n.js';
import { MIN_IMAGE_BYTES, isTrackingPixel, normalizeMime } from './images.js';
import { parseInOffscreen } from './offscreen.js';
import { collectPagePayload, fetchImagesInPage, showInPageToast } from './page-scripts.js';

const MENU = {
  page: 'vital-save-page',
  link: 'vital-save-link',
  selection: 'vital-save-selection',
  image: 'vital-save-image',
  recent: 'vital-open-recent',
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
  chrome.contextMenus.create({ id: MENU.recent, title: copy.menuRecent, contexts: ['action'] });
}

export async function openPanel(): Promise<void> {
  await chrome.windows.create({
    url: chrome.runtime.getURL(PANEL_PATH),
    type: 'popup',
    width: 380,
    height: 560,
    focused: true,
  });
}

async function toast(tabId: number | undefined, text: string): Promise<void> {
  if (tabId === undefined) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: showInPageToast,
      args: [text],
    });
  } catch {
    // chrome:// and other restricted pages cannot show an in-page toast.
  }
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
    if (buf.byteLength < MIN_IMAGE_BYTES || buf.byteLength > MAX_EXTRACT_IMAGE_BYTES) return null;
    const header = res.headers.get('content-type') ?? '';
    const mime = normalizeMime(header, buf);
    if (mime === null) return null;
    return { src, mime, blob: new Blob([buf], { type: mime }) };
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
      args: [urls, MAX_EXTRACT_IMAGE_BYTES, MIN_IMAGE_BYTES],
    });
    const rows = results[0]?.result ?? [];
    const out: FetchedImage[] = [];
    for (const row of rows) {
      const bytes = Uint8Array.from(row.data);
      const mime = normalizeMime(row.mime, bytes.buffer);
      if (mime === null) continue;
      if (!(IMAGE_MIME_TYPES as readonly string[]).includes(mime)) continue;
      out.push({ src: row.src, mime, blob: new Blob([bytes], { type: mime }) });
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
    if (found.length >= MAX_INBOX_ASSETS) return found;
  }
  if (tabId !== undefined && missing.length > 0 && found.length < MAX_INBOX_ASSETS) {
    const fromPage = await fetchFromPage(tabId, missing);
    for (const img of fromPage) {
      found.push(img);
      if (found.length >= MAX_INBOX_ASSETS) break;
    }
  }
  return found;
}

async function uploadAssets(item: InboxItem, images: FetchedImage[]): Promise<void> {
  if (images.length === 0) return;
  if (item.assets.length > 0) return;
  const assets: Array<{ attachmentId: string; originalSrc: string; sortOrder: number }> = [];
  const client = getClient();
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    if (img === undefined) continue;
    try {
      const uploaded = await client.upload({
        file: img.blob,
        mime: img.mime,
        size: img.blob.size,
      });
      assets.push({ attachmentId: uploaded.id, originalSrc: img.src, sortOrder: i });
    } catch {
      // Image ingest is best-effort; the item itself is already persisted.
    }
  }
  if (assets.length === 0) return;
  await client.patchInboxAssets(item.id, { assets });
}

async function createExtensionItem(input: CreateInboxInput): Promise<InboxItem> {
  const originalUrl = input.originalUrl;
  if (originalUrl === undefined || originalUrl === null) {
    throw new Error(copy.toastRestricted);
  }
  const { key } = await idempotencyKeyForUrl(originalUrl);
  return getClient().createInbox({ ...input, source: 'extension' }, key);
}

async function savePage(tab: chrome.tabs.Tab, selectionOnly: boolean): Promise<void> {
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
    await createExtensionItem({
      title,
      originalUrl,
      extractedText: clip(selection, 2 * 1024 * 1024),
      extractedHtml: escapeParagraph(selection),
      source: 'extension',
    });
    return;
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
  const item = await createExtensionItem({
    title: parsed.title,
    originalUrl,
    extractedText: parsed.extractedText,
    extractedHtml: parsed.extractedHtml,
    excerpt: parsed.excerpt,
    byline: parsed.byline,
    siteName: parsed.siteName,
    source: 'extension',
  });
  const images = await gatherImages(tabId, parsed.imageSrcs);
  await uploadAssets(item, images);
}

async function saveLink(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  const href = info.linkUrl;
  if (href === undefined || !isHttpUrl(href)) throw new Error(copy.toastRestricted);
  const title = clip(info.selectionText, 80) ?? clip(tab?.title, 500) ?? hostnameOf(href) ?? href;
  await createExtensionItem({
    title,
    originalUrl: href,
    excerpt: tab?.url && isHttpUrl(tab.url) ? tab.url : null,
    source: 'extension',
  });
}

async function saveImage(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  const pageUrl = info.pageUrl ?? tab?.url;
  if (pageUrl === undefined || !isHttpUrl(pageUrl)) throw new Error(copy.toastRestricted);
  const src = info.srcUrl;
  const title =
    clip(info.selectionText, 80) ?? clip(tab?.title, 500) ?? hostnameOf(pageUrl) ?? pageUrl;
  const item = await createExtensionItem({
    title,
    originalUrl: pageUrl,
    excerpt: src ?? null,
    source: 'extension',
  });
  if (src === undefined || isTrackingPixel({ src })) return;
  const tabId = tab?.id;
  const images = await gatherImages(tabId, [src]);
  await uploadAssets(item, images);
}

function failMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message !== '') return err.message;
  return copy.toastFailed;
}

async function withAuth(tab: chrome.tabs.Tab | undefined, run: () => Promise<void>): Promise<void> {
  const loggedIn = await requireAuth();
  if (!loggedIn) {
    await toast(tab?.id, copy.toastLogin);
    await openPanel();
    return;
  }
  try {
    await run();
    await toast(tab?.id, copy.toastSaved);
  } catch (err) {
    await toast(tab?.id, failMessage(err));
  }
}

export async function handleActionClick(tab: chrome.tabs.Tab): Promise<void> {
  await withAuth(tab, () => savePage(tab, false));
}

export async function handleContextMenu(
  info: chrome.contextMenus.OnClickData,
  tab?: chrome.tabs.Tab,
): Promise<void> {
  if (info.menuItemId === MENU.recent) {
    await openPanel();
    return;
  }
  await withAuth(tab, async () => {
    switch (info.menuItemId) {
      case MENU.page:
        if (tab === undefined) throw new Error(copy.toastFailed);
        await savePage(tab, false);
        break;
      case MENU.selection:
        if (tab === undefined) throw new Error(copy.toastFailed);
        await savePage(tab, true);
        break;
      case MENU.link:
        await saveLink(info, tab);
        break;
      case MENU.image:
        await saveImage(info, tab);
        break;
      default:
        break;
    }
  });
}
