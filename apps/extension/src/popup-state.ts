import { clip, hostnameOf } from './html.js';
import { copy } from './i18n.js';
import type { CapturePayload, PopupMode } from './messages.js';
import { savedAfterImagesToast, type SaveKind } from './capture-helpers.js';

export function initialMode(capture: CapturePayload): PopupMode {
  if (capture.file !== null) return 'file';
  return capture.selection.trim() !== '' ? 'selection' : 'article';
}

export function modeDisabled(mode: PopupMode, selection: string): boolean {
  return mode === 'selection' && selection.trim() === '';
}

export function titleForMode(capture: CapturePayload, mode: PopupMode): string {
  if (mode === 'selection') return clip(capture.selection, 80) ?? capture.originalUrl;
  if (mode === 'task') return clip(capture.selection, 80) ?? capture.title;
  return capture.title;
}

export function metaLine(capture: CapturePayload, mode: PopupMode): string {
  if (mode === 'selection') return `${capture.selection.trim().length} 字`;
  const parts: string[] = [];
  const site = capture.siteName ?? hostnameOf(capture.originalUrl);
  if (site !== null && site !== '') parts.push(site);
  const words = capture.extractedText?.trim().length ?? 0;
  if (words > 0) parts.push(`${words} 字`);
  if (capture.imageSrcs.length > 0) parts.push(`${capture.imageSrcs.length} 张图`);
  return parts.join(' · ');
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
