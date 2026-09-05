import type { InboxItem, UserProfile } from '@vital/dto';

export type PanelRequest =
  | { type: 'session' }
  | { type: 'login'; email: string; password: string }
  | { type: 'logout' }
  | { type: 'recent' }
  | { type: 'open-web' };

export type PanelResponse =
  | { ok: true; session: { loggedIn: false } | { loggedIn: true; profile: UserProfile } }
  | { ok: true; items: InboxItem[] }
  | { ok: true }
  | { ok: false; error: string };

export interface OffscreenParseRequest {
  type: 'parse';
  target: 'offscreen';
  html: string;
  url: string;
}

export function isPanelRequest(value: unknown): value is PanelRequest {
  if (typeof value !== 'object' || value === null) return false;
  if (!('type' in value) || typeof value.type !== 'string') return false;
  return (
    value.type === 'session' ||
    value.type === 'login' ||
    value.type === 'logout' ||
    value.type === 'recent' ||
    value.type === 'open-web'
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
