import { INBOX_ASSET_MIME_TYPES, MAX_INBOX_ASSETS, imageSrcKeys } from '@vital/dto';
import { parseDim } from './html.js';

const TRACKER_HOST =
  /(^|\.)(google-analytics\.com|googletagmanager\.com|googleadservices\.com|doubleclick\.net|facebook\.com|facebook\.net|fbcdn\.net|scorecardresearch\.com|quantserve\.com|adsrvr\.org|adnxs\.com|advertising\.com)$/i;

const TRACKER_PATH = /\/(pixel|beacon|track|collect|tr\/?$)|1x1|spacer\.(gif|png|jpg)/i;

/** Tiny payload is almost always a tracking pixel / spacer. */
export const MIN_IMAGE_BYTES = 150;

const KEEP_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function shouldConvertImage(mime: string | null): boolean {
  if (mime === null) return true;
  return !KEEP_MIME.has(mime);
}

export function largestSrcset(srcset: string | null | undefined): string | null {
  if (srcset === undefined || srcset === null || srcset.trim() === '') return null;
  let best: { url: string; score: number } | null = null;
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/);
    const url = bits[0];
    if (url === undefined || url === '') continue;
    let score = 1;
    const desc = bits[1];
    if (desc !== undefined && desc.endsWith('w')) {
      score = Number.parseInt(desc, 10) || 1;
    } else if (desc !== undefined && desc.endsWith('x')) {
      score = (Number.parseFloat(desc) || 1) * 10_000;
    }
    if (best === null || score > best.score) best = { url, score };
  }
  return best?.url ?? null;
}

export function imageSrcFrom(img: Element): string | null {
  for (const attr of ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc'] as const) {
    const raw = img.getAttribute(attr)?.trim();
    if (raw !== undefined && raw !== '' && !raw.startsWith('data:')) return raw;
  }
  const src = img.getAttribute('src')?.trim();
  if (src !== undefined && src !== '' && !src.startsWith('data:')) return src;
  return largestSrcset(img.getAttribute('srcset') ?? img.getAttribute('data-srcset'));
}

export function canonicalizeImageSrc(raw: string, pageUrl: string): string | null {
  try {
    const abs = new URL(raw, pageUrl);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
    abs.hash = '';
    return abs.href;
  } catch {
    return null;
  }
}

export function imageSrcKey(src: string): string {
  return imageSrcKeys(src)[0] ?? src;
}

export function promoteLazyImages(root: ParentNode, pageUrl?: string): void {
  for (const img of root.querySelectorAll('img')) {
    const raw = imageSrcFrom(img);
    if (raw === null) continue;
    const src = pageUrl === undefined ? raw : canonicalizeImageSrc(raw, pageUrl);
    if (src === null) continue;
    img.setAttribute('src', src);
    img.removeAttribute('srcset');
    img.removeAttribute('data-src');
    img.removeAttribute('data-original');
    img.removeAttribute('data-lazy-src');
    img.removeAttribute('data-actualsrc');
    img.removeAttribute('data-srcset');
  }
}

function httpMediaSrc(raw: string | null | undefined, pageUrl?: string): string | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  if (raw.startsWith('blob:') || raw.startsWith('data:')) return null;
  if (pageUrl === undefined) {
    return raw.startsWith('http://') || raw.startsWith('https://') ? raw : null;
  }
  return canonicalizeImageSrc(raw, pageUrl);
}

/** Absolutize img/video URLs so later rehost can match srcs in saved HTML. */
export function promoteMedia(root: ParentNode, pageUrl?: string): void {
  promoteLazyImages(root, pageUrl);
  for (const video of root.querySelectorAll('video')) {
    const live = video instanceof HTMLVideoElement ? video.currentSrc : '';
    const raw =
      live ||
      video.getAttribute('src') ||
      video.querySelector('source')?.getAttribute('src') ||
      null;
    const src = httpMediaSrc(raw, pageUrl);
    if (src !== null) {
      video.setAttribute('src', src);
      video.setAttribute('controls', '');
      if (!video.hasAttribute('playsinline')) video.setAttribute('playsinline', '');
    }
    const poster = httpMediaSrc(video.getAttribute('poster'), pageUrl);
    if (poster !== null) video.setAttribute('poster', poster);
  }
}

export function isTrackingPixel(img: {
  src: string;
  width?: number | null;
  height?: number | null;
}): boolean {
  const width = img.width;
  const height = img.height;
  if (width !== undefined && width !== null && height !== undefined && height !== null) {
    if (width <= 2 && height <= 2) return true;
  }
  if (width === 1 || height === 1) return true;

  let url: URL;
  try {
    url = new URL(img.src);
  } catch {
    return true;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  if (TRACKER_HOST.test(url.hostname)) return true;
  if (TRACKER_PATH.test(`${url.pathname}${url.search}`)) return true;
  return false;
}

function pushSrc(
  srcs: string[],
  seen: Set<string>,
  raw: string,
  pageUrl: string,
  width?: number | null,
  height?: number | null,
  limit = MAX_INBOX_ASSETS,
): void {
  if (srcs.length >= limit) return;
  const href = canonicalizeImageSrc(raw, pageUrl);
  if (href === null) return;
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    return;
  }
  if (/\.svg(\?|$)/i.test(path)) return;
  if (isTrackingPixel({ src: href, width, height })) return;
  if (seen.has(href)) return;
  seen.add(href);
  srcs.push(href);
}

export function collectArticleImages(
  html: string,
  pageUrl: string,
  limit = MAX_INBOX_ASSETS,
): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.setAttribute('href', pageUrl);
  doc.head.prepend(base);
  promoteMedia(doc, pageUrl);

  const srcs: string[] = [];
  const seen = new Set<string>();
  for (const img of doc.querySelectorAll('img')) {
    const raw = imageSrcFrom(img);
    if (raw === null) continue;
    pushSrc(
      srcs,
      seen,
      raw,
      pageUrl,
      parseDim(img.getAttribute('width')),
      parseDim(img.getAttribute('height')),
      limit,
    );
  }
  for (const source of doc.querySelectorAll('picture source')) {
    const raw = largestSrcset(source.getAttribute('srcset'));
    if (raw === null) continue;
    pushSrc(srcs, seen, raw, pageUrl, null, null, limit);
  }
  for (const video of doc.querySelectorAll('video')) {
    const poster = video.getAttribute('poster');
    if (poster !== null && poster.trim() !== '') {
      pushSrc(srcs, seen, poster, pageUrl, null, null, limit);
    }
    const src = video.getAttribute('src');
    if (src !== null && src.trim() !== '') {
      pushSrc(srcs, seen, src, pageUrl, null, null, limit);
    }
    for (const source of video.querySelectorAll('source')) {
      const sourceSrc = source.getAttribute('src');
      if (sourceSrc !== null && sourceSrc.trim() !== '') {
        pushSrc(srcs, seen, sourceSrc, pageUrl, null, null, limit);
      }
    }
  }
  return srcs;
}

export function normalizeMime(headerMime: string, bytes: ArrayBuffer): string | null {
  const header = headerMime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (header === 'image/jpg') {
    return 'image/jpeg';
  }
  if ((INBOX_ASSET_MIME_TYPES as readonly string[]).includes(header)) {
    return header;
  }
  return sniffMime(bytes);
}

function byte(u8: Uint8Array, i: number): number {
  return u8[i] ?? -1;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function convertRasterToJpeg(bytes: Uint8Array): Promise<Blob | null> {
  const bitmap = await createImageBitmap(new Blob([bytesToArrayBuffer(bytes)]));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.88);
  });
}

export function sniffMime(bytes: ArrayBuffer): string | null {
  const u8 = new Uint8Array(bytes);
  if (u8.length < 12) return null;
  if (byte(u8, 0) === 0xff && byte(u8, 1) === 0xd8 && byte(u8, 2) === 0xff) return 'image/jpeg';
  if (
    byte(u8, 0) === 0x89 &&
    byte(u8, 1) === 0x50 &&
    byte(u8, 2) === 0x4e &&
    byte(u8, 3) === 0x47
  ) {
    return 'image/png';
  }
  if (
    byte(u8, 0) === 0x47 &&
    byte(u8, 1) === 0x49 &&
    byte(u8, 2) === 0x46 &&
    byte(u8, 3) === 0x38
  ) {
    return 'image/gif';
  }
  if (
    byte(u8, 0) === 0x52 &&
    byte(u8, 1) === 0x49 &&
    byte(u8, 2) === 0x46 &&
    byte(u8, 3) === 0x46 &&
    byte(u8, 8) === 0x57 &&
    byte(u8, 9) === 0x45 &&
    byte(u8, 10) === 0x42 &&
    byte(u8, 11) === 0x50
  ) {
    return 'image/webp';
  }
  if (
    byte(u8, 4) === 0x66 &&
    byte(u8, 5) === 0x74 &&
    byte(u8, 6) === 0x79 &&
    byte(u8, 7) === 0x70
  ) {
    return 'video/mp4';
  }
  if (byte(u8, 0) === 0x1a && byte(u8, 1) === 0x45 && byte(u8, 2) === 0xdf && byte(u8, 3) === 0xa3) {
    return 'video/webm';
  }
  return null;
}
