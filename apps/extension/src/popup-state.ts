import { clip, hostnameOf } from './html.js';
import { copy } from './i18n.js';
import type { CapturePayload, PopupMode } from './messages.js';
import type { ParsedArticle } from './parse-article.js';
import { savedAfterImagesToast, type SaveKind } from './capture-helpers.js';

export function initialMode(capture: CapturePayload): PopupMode {
  if (capture.file !== null) return 'file';
  return capture.selection.trim() !== '' ? 'selection' : 'article';
}

export function modeDisabled(mode: PopupMode, capture: CapturePayload): boolean {
  if (mode === 'selection') return capture.selection.trim() === '';
  if (mode === 'page') return capture.rawHtml === null;
  return false;
}

export function titleForMode(
  capture: CapturePayload,
  mode: PopupMode,
  pageParsed?: ParsedArticle | null,
): string {
  if (mode === 'selection') return clip(capture.selection, 80) ?? capture.originalUrl;
  if (mode === 'task') return clip(capture.selection, 80) ?? capture.title;
  if (mode === 'page') return pageParsed?.title ?? capture.title;
  return capture.title;
}

export function metaLine(
  capture: CapturePayload,
  mode: PopupMode,
  pageParsed?: ParsedArticle | null,
): string {
  if (mode === 'selection') return `${capture.selection.trim().length} 字`;
  const parts: string[] = [];
  const site = capture.siteName ?? hostnameOf(capture.originalUrl);
  if (site !== null && site !== '') parts.push(site);
  const text = mode === 'page' ? (pageParsed?.extractedText ?? null) : capture.extractedText;
  const images = mode === 'page' ? (pageParsed?.imageSrcs ?? []) : capture.imageSrcs;
  const words = text?.trim().length ?? 0;
  if (words > 0) parts.push(`${words} 字`);
  if (images.length > 0) parts.push(`${images.length} 张图`);
  return parts.join(' · ');
}

export type PageParseCache = {
  parsed: ParsedArticle | null;
  inFlight: Promise<ParsedArticle | null> | null;
};

export function createPageParseCache(): PageParseCache {
  return { parsed: null, inFlight: null };
}

/** Request page parse once; later callers reuse the cache or the in-flight promise. */
export function ensurePageParsed(
  cache: PageParseCache,
  rawHtml: string | null,
  url: string,
  request: (html: string, url: string) => Promise<ParsedArticle>,
): Promise<ParsedArticle | null> {
  if (cache.parsed !== null) return Promise.resolve(cache.parsed);
  if (rawHtml === null) return Promise.resolve(null);
  if (cache.inFlight !== null) return cache.inFlight;
  const pending = request(rawHtml, url)
    .then((parsed) => {
      cache.parsed = parsed;
      return parsed;
    })
    .finally(() => {
      if (cache.inFlight === pending) cache.inFlight = null;
    });
  cache.inFlight = pending;
  return pending;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatBytes(size: number): string {
  if (size >= 1024 ** 3) return `${round1(size / 1024 ** 3)}GB`;
  if (size >= 1024 ** 2) return `${round1(size / 1024 ** 2)}MB`;
  if (size >= 1024) return `${round1(size / 1024)}KB`;
  return `${size}B`;
}

/** Direct-file meta line: kind (video/audio/PDF) plus human-readable size. */
export function fileMetaLine(file: { mime: string; size: number }): string {
  const kind = file.mime.startsWith('video/')
    ? '视频'
    : file.mime.startsWith('audio/')
      ? '音频'
      : file.mime.endsWith('/pdf') || file.mime.endsWith('+pdf')
        ? 'PDF'
        : '文件';
  return `${kind} · ${formatBytes(file.size)}`;
}

export function progressLabel(done: number, total: number): string {
  return `${done}/${total}`;
}

export function savedLabel(kind: SaveKind, failed: number): string {
  if (kind === 'task') return copy.toastTaskSaved;
  if (kind === 'existing') return copy.toastAlready;
  if (failed === 0) return copy.toastSaved;
  return savedAfterImagesToast(failed);
}
