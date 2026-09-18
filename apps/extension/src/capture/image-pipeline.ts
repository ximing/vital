import {
  INBOX_ASSET_MIME_TYPES,
  MAX_INBOX_ASSETS,
  MAX_UPLOAD_BYTES,
  imageSrcKeys,
  type InboxItem,
} from '@vital/dto';
import { canonicalizeUrl, sha256Hex } from '../canonical.js';
import { getClient } from '../client.js';
import type { DirectFile } from '../file-kind.js';
import {
  MIN_IMAGE_BYTES,
  bytesToArrayBuffer,
  normalizeMime,
  shouldConvertImage,
} from '../images.js';
import { requestImageHostAccess } from '../image-hosts.js';
import { convertInOffscreen } from '../offscreen.js';
import { fetchImagesInPage } from '../page-scripts.js';
import { createStreamPartSource } from '../stream-rehost.js';
import { outcomeAction, type Announce, type CaptureOutcome } from './types.js';

export interface FetchedImage {
  src: string;
  mime: string;
  blob: Blob;
}

async function fetchOneFromSw(src: string): Promise<FetchedImage | null> {
  try {
    const res = await fetch(src, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < MIN_IMAGE_BYTES || buf.byteLength > MAX_UPLOAD_BYTES) return null;
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
      args: [urls, MAX_UPLOAD_BYTES, MIN_IMAGE_BYTES],
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

/** Idempotent create may replay a body from before assets were attached. */
export async function itemNeedingRehost(
  item: InboxItem,
  created: boolean,
): Promise<InboxItem | null> {
  if (created) return item;
  try {
    return await getClient().getInbox(item.id);
  } catch {
    return item;
  }
}

export async function gatherImages(
  tabId: number | undefined,
  srcs: string[],
): Promise<FetchedImage[]> {
  if (srcs.length > 0) await requestImageHostAccess();
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
  const isVideo = mime.startsWith('video/');
  if (!isVideo && shouldConvertImage(mime === '' ? null : mime)) {
    try {
      const converted = await convertInOffscreen(blob);
      mime = converted.mime;
      blob = converted.blob;
    } catch {
      // Fall through and try the original bytes if the MIME is already allowed.
    }
  }
  if (!(INBOX_ASSET_MIME_TYPES as readonly string[]).includes(mime)) return null;
  if (blob.size < MIN_IMAGE_BYTES || blob.size > MAX_UPLOAD_BYTES) return null;
  return { src: image.src, mime, blob };
}

export async function rehostImages(
  item: InboxItem,
  images: FetchedImage[],
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<{ item: InboxItem; failed: number }> {
  const have = new Set(item.assets.flatMap((asset) => imageSrcKeys(asset.originalSrc)));
  const assets: Array<{ attachmentId: string; originalSrc: string; sortOrder: number }> =
    item.assets.map((asset, index) => ({
      attachmentId: asset.attachmentId,
      originalSrc: asset.originalSrc,
      sortOrder: asset.sortOrder ?? index,
    }));
  const pending = images.filter(
    (image) => !imageSrcKeys(image.src).some((key) => have.has(key)),
  );
  const client = getClient();
  let failed = 0;
  for (let i = 0; i < pending.length; i += 1) {
    const raw = pending[i];
    if (raw === undefined) continue;
    const prepared = await prepareUpload(raw);
    if (prepared === null) {
      failed += 1;
      await onProgress?.(i + 1, pending.length);
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
      for (const key of imageSrcKeys(prepared.src)) have.add(key);
    } catch {
      failed += 1;
    }
    await onProgress?.(i + 1, pending.length);
  }
  if (assets.length === 0) return { item, failed };
  // patchInboxAssets rebinds the body doc's media nodes to these attachments server-side.
  const bound = pending.length > 0 ? await client.patchInboxAssets(item.id, { assets }) : item;
  return { item: bound, failed };
}

interface RehostState {
  attachmentId: string;
  size: number;
  mime: string;
}

/** Stream a direct file straight into multipart uploads, no full download in
 * memory. The resume handle in session storage survives a crashed worker. */
export async function rehostDirectFile(
  file: DirectFile,
  onProgress?: (loaded: number, total: number) => Promise<void> | void,
): Promise<{ attachmentId: string | null; failed: number }> {
  const resumeKey = `vital.rehost.${await sha256Hex(canonicalizeUrl(file.url))}`;
  const stored = await chrome.storage.session.get(resumeKey);
  const prior = stored[resumeKey] as RehostState | undefined;
  try {
    const res = await fetch(file.url, { credentials: 'omit' });
    if (!res.ok || res.body === null) return { attachmentId: null, failed: 1 };
    const source = createStreamPartSource(res.body);
    const uploaded = await getClient().upload({
      partSource: async (start, end) => {
        const part = await source.partSource(start, end);
        // Integrity gate on the final part: the body must end exactly at the
        // declared size, so a mutated/over-long file fails before complete.
        if (end >= file.size) await source.finish();
        return part;
      },
      mime: file.mime,
      size: file.size,
      resumeId: prior?.attachmentId,
      onProgress: (loaded, total) => {
        void onProgress?.(loaded, total);
      },
      onAttachmentId: (id) => {
        void chrome.storage.session.set({
          [resumeKey]: { attachmentId: id, size: file.size, mime: file.mime } satisfies RehostState,
        });
      },
    });
    await chrome.storage.session.remove(resumeKey);
    return { attachmentId: uploaded.id, failed: 0 };
  } catch {
    return { attachmentId: null, failed: 1 }; // resume state stays for retry
  }
}

export async function rehostWithFeedback(
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
