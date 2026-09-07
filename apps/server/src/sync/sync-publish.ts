const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function pathOf(url: string): string {
  const q = url.indexOf('?');
  return q < 0 ? url : url.slice(0, q);
}

/** Writes under /api/v1 except auth, sync, and read-only POST /search. */
export function isMutatingApi(method: string, url: string): boolean {
  if (!MUTATING.has(method)) return false;
  const path = pathOf(url);
  if (!path.startsWith('/api/v1/')) return false;
  if (path.startsWith('/api/v1/auth')) return false;
  if (path.startsWith('/api/v1/sync')) return false;
  if (path === '/api/v1/search' || path.startsWith('/api/v1/search/')) return false;
  return true;
}

export function shouldPublish(
  method: string,
  url: string,
  status: number,
  userId: string | undefined,
): boolean {
  if (!userId) return false;
  if (status < 200 || status >= 300) return false;
  return isMutatingApi(method, url);
}
