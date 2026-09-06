import type { InboxItem, List, UserProfile } from '@vital/dto';

export interface CaptureDraft {
  title: string;
  note: string;
  originalUrl: string;
  extractedText: string | null;
  extractedHtml: string | null;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
  imageSrcs: string[];
  selection: string;
  tabId: number | null;
  mode: 'inbox' | 'task';
}

export type PanelRequest =
  | { type: 'session' }
  | { type: 'logout' }
  | { type: 'recent' }
  | { type: 'open-web' }
  | { type: 'open-login' }
  | { type: 'exchange-code'; code: string }
  | { type: 'lists' }
  | { type: 'load-draft' }
  | { type: 'clear-draft' }
  | {
      type: 'commit-draft';
      title: string;
      note: string;
      mode: 'inbox' | 'task';
      listId?: string;
    };

export type PanelResponse =
  | { ok: true; session: { loggedIn: false } | { loggedIn: true; profile: UserProfile } }
  | { ok: true; items: InboxItem[] }
  | { ok: true; lists: List[] }
  | { ok: true; draft: CaptureDraft | null }
  | { ok: true }
  | { ok: false; error: string };

export interface OffscreenParseRequest {
  type: 'parse';
  target: 'offscreen';
  html: string;
  url: string;
}

export interface OffscreenConvertRequest {
  type: 'convert-image';
  target: 'offscreen';
  mime: string;
  data: string;
}

export function isPanelRequest(value: unknown): value is PanelRequest {
  if (typeof value !== 'object' || value === null) return false;
  if (!('type' in value) || typeof value.type !== 'string') return false;
  return (
    value.type === 'session' ||
    value.type === 'logout' ||
    value.type === 'recent' ||
    value.type === 'open-web' ||
    value.type === 'open-login' ||
    value.type === 'exchange-code' ||
    value.type === 'lists' ||
    value.type === 'load-draft' ||
    value.type === 'clear-draft' ||
    value.type === 'commit-draft'
  );
}

export function isOffscreenParse(value: unknown): value is OffscreenParseRequest {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.type === 'parse' &&
    rec.target === 'offscreen' &&
    typeof rec.html === 'string' &&
    typeof rec.url === 'string'
  );
}

export function isOffscreenConvert(value: unknown): value is OffscreenConvertRequest {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.type === 'convert-image' &&
    rec.target === 'offscreen' &&
    typeof rec.mime === 'string' &&
    typeof rec.data === 'string'
  );
}

export function isExternalAuthMessage(
  value: unknown,
): value is { type: 'vital-extension-auth'; code: string } {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.type === 'vital-extension-auth' && typeof rec.code === 'string' && rec.code.length >= 20
  );
}
