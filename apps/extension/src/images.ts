import { IMAGE_MIME_TYPES, MAX_INBOX_ASSETS } from '@vital/dto';
import { parseDim } from './html.js';

const TRACKER_HOST =
  /(^|\.)(google-analytics\.com|googletagmanager\.com|googleadservices\.com|doubleclick\.net|facebook\.com|facebook\.net|fbcdn\.net|scorecardresearch\.com|quantserve\.com|adsrvr\.org|adnxs\.com|advertising\.com)$/i;

const TRACKER_PATH = /\/(pixel|beacon|track|collect|tr\/?$)|1x1|spacer\.(gif|png|jpg)/i;

/** Tiny payload is almost always a tracking pixel / spacer. */
export const MIN_IMAGE_BYTES = 150;

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

export function collectArticleImages(
  html: string,
  pageUrl: string,
  limit = MAX_INBOX_ASSETS,
): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.setAttribute('href', pageUrl);
  doc.head.prepend(base);

  const srcs: string[] = [];
  const seen = new Set<string>();
  for (const img of doc.querySelectorAll('img')) {
    const raw = img.getAttribute('src');
    if (raw === null || raw === '') continue;
    let abs: URL;
    try {
      abs = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    if (/\.svg(\?|$)/i.test(abs.pathname)) continue;
    if (
      isTrackingPixel({
        src: abs.href,
        width: parseDim(img.getAttribute('width')),
        height: parseDim(img.getAttribute('height')),
      })
    ) {
      continue;
    }
    if (seen.has(abs.href)) continue;
    seen.add(abs.href);
    srcs.push(abs.href);
    if (srcs.length >= limit) break;
  }
  return srcs;
}

export function normalizeMime(headerMime: string, bytes: ArrayBuffer): string | null {
  const header = headerMime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (header === 'image/jpg') {
    return 'image/jpeg';
  }
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(header)) {
    return header;
  }
  return sniffMime(bytes);
}

function byte(u8: Uint8Array, i: number): number {
  return u8[i] ?? -1;
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
  return null;
}
