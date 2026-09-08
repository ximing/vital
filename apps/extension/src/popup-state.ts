import { clip, hostnameOf } from './html.js';
import { copy } from './i18n.js';
import type { CapturePayload, PopupMode } from './messages.js';
import { savedAfterImagesToast, type SaveKind } from './capture-helpers.js';

export function initialMode(selection: string): PopupMode {
  return selection.trim() !== '' ? 'selection' : 'article';
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

export function progressLabel(done: number, total: number): string {
  return `转存图片 ${done}/${total}`;
}

export function savedLabel(kind: SaveKind, failed: number): string {
  if (kind === 'task') return copy.toastTaskSaved;
  if (kind === 'existing') return copy.toastAlready;
  if (failed === 0) return copy.toastSaved;
  return savedAfterImagesToast(failed);
}
