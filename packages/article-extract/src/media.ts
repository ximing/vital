import { MAX_INBOX_ASSETS, imageSrcKeys } from '@vital/dto';
import { parseDim } from './html.js';

const TRACKER_HOST =
  /(^|\.)(google-analytics\.com|googletagmanager\.com|googleadservices\.com|doubleclick\.net|facebook\.com|facebook\.net|fbcdn\.net|scorecardresearch\.com|quantserve\.com|adsrvr\.org|adnxs\.com|advertising\.com)$/i;

const TRACKER_PATH = /\/(pixel|beacon|track|collect|tr\/?$)|1x1|spacer\.(gif|png|jpg)/i;

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
  if (isTrackingPixel({ src: href, width: width ?? null, height: height ?? null })) return;
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
