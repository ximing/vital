import type { CreateInboxInput } from '@vital/dto';
import { clip, escapeParagraph } from './html.js';
import { copy } from './i18n.js';
import type { CapturePayload } from './messages.js';

export type SaveKind = 'created' | 'existing' | 'task';

export function inboxReaderUrl(webUrl: string, id: string): string {
  return `${webUrl.replace(/\/$/, '')}/inbox/${id}`;
}

export function inboxListUrl(webUrl: string): string {
  return `${webUrl.replace(/\/$/, '')}/todos/lists/smart:inbox`;
}

export function extensionLoginUrl(webUrl: string, extensionId: string): string {
  const base = webUrl.replace(/\/$/, '');
  return `${base}/auth/extension?id=${encodeURIComponent(extensionId)}`;
}

export function taskNotesFromCapture(url: string, selection?: string): string {
  const trimmed = selection?.trim() ?? '';
  if (trimmed === '') return url;
  return `${url}\n\n${trimmed}`;
}

export function saveToast(kind: SaveKind): { text: string; actionLabel: string } {
  if (kind === 'existing') return { text: copy.toastAlready, actionLabel: copy.toastOpen };
  if (kind === 'task') return { text: copy.toastTaskSaved, actionLabel: copy.toastOpen };
  return { text: copy.toastSaved, actionLabel: copy.toastOpen };
}

export function uploadProgressToast(done: number, total: number): string {
  return `上传图片 ${done}/${total}`;
}

export function savedAfterImagesToast(failed: number): string {
  if (failed === 0) return copy.toastDone;
  return `已保存，${failed} 张图失败`;
}

export function badgeText(
  kind: 'ok' | 'fail' | 'progress',
  progress?: { done: number; total: number },
): string {
  if (kind === 'ok') return '✓';
  if (kind === 'fail') return '!';
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const text = `${done}/${total}`;
  return text.length <= 4 ? text : String(done).slice(0, 4);
}

export type SaveFeedbackEvent =
  | { type: 'saving' }
  | { type: 'saved'; kind: SaveKind }
  | { type: 'upload'; done: number; total: number }
  | { type: 'imagesDone'; failed: number }
  | { type: 'fail'; message: string };

export function feedbackView(event: SaveFeedbackEvent): {
  text: string;
  badge: string;
  actionLabel?: string;
} {
  if (event.type === 'saving') return { text: copy.toastSaving, badge: '…' };
  if (event.type === 'saved') {
    const shown = saveToast(event.kind);
    return { text: shown.text, badge: badgeText('ok'), actionLabel: shown.actionLabel };
  }
  if (event.type === 'upload') {
    return {
      text: uploadProgressToast(event.done, event.total),
      badge: badgeText('progress', { done: event.done, total: event.total }),
    };
  }
  if (event.type === 'imagesDone') {
    return {
      text: savedAfterImagesToast(event.failed),
      badge: event.failed > 0 ? badgeText('fail') : badgeText('ok'),
    };
  }
  return { text: event.message, badge: badgeText('fail') };
}

export function isTrustedWebOrigin(pageUrl: string | undefined, webUrl: string): boolean {
  if (pageUrl === undefined || pageUrl === '') return false;
  try {
    const incoming = new URL(pageUrl);
    const web = new URL(webUrl);
    if (incoming.origin === web.origin) return true;
    const samePort = incoming.port === web.port || (incoming.port === '' && web.port === '');
    if (!samePort) return false;
    if (web.hostname === 'localhost' && incoming.hostname === '127.0.0.1') return true;
    if (web.hostname === '127.0.0.1' && incoming.hostname === 'localhost') return true;
    return false;
  } catch {
    return false;
  }
}

export function inboxInputFromCapture(
  capture: CapturePayload,
  title: string,
  note: string,
): CreateInboxInput {
  return {
    title,
    originalUrl: capture.originalUrl,
    extractedText: capture.extractedText,
    extractedHtml: capture.extractedHtml,
    excerpt: clip(note, 500) ?? capture.excerpt,
    byline: capture.byline,
    siteName: capture.siteName,
    source: 'extension',
  };
}

export function selectionInputFromCapture(
  capture: CapturePayload,
  title: string,
): CreateInboxInput {
  return {
    title,
    originalUrl: capture.originalUrl,
    extractedText: clip(capture.selection, 2 * 1024 * 1024),
    extractedHtml: escapeParagraph(capture.selection),
    excerpt: clip(capture.selection, 500),
    byline: null,
    siteName: capture.siteName,
    source: 'extension',
  };
}
