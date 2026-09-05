import { createHash } from 'node:crypto';
import { AppError } from '../errors.js';

/** Strip fragment, lowercase host, drop utm_*, strip trailing slash except `/`. */
export function canonicalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  const keep: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => {
    if (!key.toLowerCase().startsWith('utm_')) keep.push([key, value]);
  });
  url.search = '';
  for (const [key, value] of keep) url.searchParams.append(key, value);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.href;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function idempotencyKeyForUrl(raw: string): { canonicalUrl: string; key: string } {
  const canonicalUrl = canonicalizeUrl(raw);
  return { canonicalUrl, key: sha256Hex(canonicalUrl) };
}
