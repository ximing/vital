import type { InboxItem, List, UserProfile } from '@vital/dto';
import type { SaveKind } from './capture-helpers.js';

export type PopupMode = 'article' | 'selection' | 'task';

export interface CapturePayload {
  title: string;
  originalUrl: string;
  extractedText: string | null;
  extractedHtml: string | null;
  excerpt: string | null;
  byline: string | null;
  siteName: string | null;
  imageSrcs: string[];
  selection: string;
  tabId: number | null;
}

export const COMMIT_PORT_NAME = 'vital-commit';

export interface CommitPortMessage {
  type: 'commit-capture';
  capture: CapturePayload;
  title: string;
  note: string;
  mode: PopupMode;
  listId?: string;
}

export type CommitPortEvent =
  | { type: 'created'; kind: SaveKind; id: string }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; failed: number }
  | { type: 'error'; message: string };

export type PanelRequest =
  | { type: 'session' }
  | { type: 'logout' }
  | { type: 'recent' }
  | { type: 'open-web' }
  | { type: 'open-login' }
  | { type: 'exchange-code'; code: string }
  | { type: 'lists' }
  | { type: 'capture-active-tab' };

export type PanelResponse =
  | { ok: true; session: { loggedIn: false } | { loggedIn: true; profile: UserProfile } }
  | { ok: true; items: InboxItem[] }
  | { ok: true; lists: List[] }
  | { ok: true; capture: CapturePayload | null }
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
    value.type === 'capture-active-tab'
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

export function isCommitPortMessage(value: unknown): value is CommitPortMessage {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  if (rec.type !== 'commit-capture') return false;
  if (typeof rec.title !== 'string' || typeof rec.note !== 'string') return false;
  if (rec.mode !== 'article' && rec.mode !== 'selection' && rec.mode !== 'task') return false;
  if (rec.listId !== undefined && typeof rec.listId !== 'string') return false;
  if (typeof rec.capture !== 'object' || rec.capture === null) return false;
  const cap = rec.capture as Record<string, unknown>;
  return (
    typeof cap.title === 'string' &&
    typeof cap.originalUrl === 'string' &&
    Array.isArray(cap.imageSrcs) &&
    typeof cap.selection === 'string'
  );
}
