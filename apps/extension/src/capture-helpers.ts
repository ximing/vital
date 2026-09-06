import { copy } from './i18n.js';

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
