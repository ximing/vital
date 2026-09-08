import { useEffect, useState } from 'react';
import { client } from '@/api/client';

/**
 * Report markdown keeps stable `/api/v1/uploads/<id>` refs (no data migration).
 * The render layer swaps them for signed GET urls via the JSON endpoint.
 */
const UPLOAD_ID_RE =
  /\/api\/v1\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
const SINGLE_REF_RE =
  /^\/api\/v1\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Hard cap on cache freshness; entries also respect the server's expiresIn. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type CacheEntry = { url: string; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();

function freshEntry(id: string): CacheEntry | undefined {
  const hit = cache.get(id);
  if (hit && hit.expiresAt > Date.now()) return hit;
  return undefined;
}

/** All distinct upload ids referenced anywhere in a markdown doc. */
export function uploadIdsOf(bodyMd: string): string[] {
  const ids = new Set<string>();
  for (const match of bodyMd.matchAll(UPLOAD_ID_RE)) {
    ids.add(match[1].toLowerCase());
  }
  return [...ids];
}

/** The upload id of a single src/href ref, or null when it is not one. */
export function uploadIdOf(ref: string): string | null {
  const match = SINGLE_REF_RE.exec(ref.trim());
  return match ? match[1].toLowerCase() : null;
}

/** Resolve one id to a signed url, caching the result for later renders. */
export function fetchUploadUrl(id: string): Promise<string> {
  const hit = freshEntry(id);
  if (hit) return Promise.resolve(hit.url);
  const pending = inflight.get(id);
  if (pending) return pending;
  const request = client
    .getUploadUrl(id)
    .then((res) => {
      cache.set(id, {
        url: res.url,
        expiresAt: Date.now() + Math.min(res.expiresIn * 1000, CACHE_TTL_MS),
      });
      return res.url;
    })
    .finally(() => {
      inflight.delete(id);
    });
  inflight.set(id, request);
  return request;
}

function snapshotOf(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const hit = freshEntry(id);
    if (hit) out[id] = hit.url;
  }
  return out;
}

/**
 * id → signed url for every upload ref in the editor's live markdown.
 * Unresolved ids are simply absent until their fetch lands (the fetch bumps
 * `version` so the render re-reads the warmed module cache).
 */
export function useUploadUrls(bodyMd: string): Record<string, string> {
  const key = uploadIdsOf(bodyMd).join(',');
  const [, setVersion] = useState(0);

  useEffect(() => {
    const ids = key === '' ? [] : key.split(',');
    const missing = ids.filter((id) => freshEntry(id) === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map((id) => fetchUploadUrl(id).catch(() => null))).then(() => {
      if (!cancelled) setVersion((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return snapshotOf(key === '' ? [] : key.split(','));
}
