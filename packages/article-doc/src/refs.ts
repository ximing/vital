import type { DocAssetUrl } from './types.js';

export const UPLOAD_RE =
  /\/api\/v1\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i;

/** Stable media reference stored in doc nodes: `/api/v1/uploads/<attachmentId>`. */
export function uploadRefOf(attachmentId: string): string {
  return `/api/v1/uploads/${attachmentId}`;
}

export function attachmentIdOfUploadRef(src: string): string | null {
  return UPLOAD_RE.exec(src)?.[1] ?? null;
}

/** http(s) absolute URL, or protocol-relative absolutized to https. */
export function absolutizeHttpUrl(src: string): string | null {
  const trimmed = src.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/\/[^/]/.test(trimmed)) return `https:${trimmed}`;
  return null;
}

/** Media src policy: upload ref or http(s); everything else is dropped. */
export function safeMediaSrc(src: string): string | null {
  if (UPLOAD_RE.test(src)) return src.trim();
  return absolutizeHttpUrl(src);
}

export function isSafeHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}

/** Media src allowed in a stored doc — same policy as safeMediaSrc. */
export function isAllowedDocMediaSrc(src: string): boolean {
  return safeMediaSrc(src) !== null;
}

/**
 * Resolve a doc media src for rendering: upload refs resolve through the
 * item's assets (server-signed URL), external http(s) passes through.
 */
export function resolveDocMediaUrl(src: string, assets: readonly DocAssetUrl[]): string | null {
  const attachmentId = attachmentIdOfUploadRef(src);
  if (attachmentId !== null) {
    return assets.find((asset) => asset.attachmentId === attachmentId)?.url ?? null;
  }
  return absolutizeHttpUrl(src);
}
