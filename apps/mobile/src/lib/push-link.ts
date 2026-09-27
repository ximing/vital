const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VitalPushTarget =
  | { kind: 'task'; id: string }
  | { kind: 'day'; id: string }
  | { kind: 'today' };

/** vital://task/<id> and vital://day/<id> are what a Huawei notification click opens. */
export function parseVitalPushUrl(raw: string | null): VitalPushTarget | null {
  if (raw === null || raw === '') return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'vital:') return null;
  const host = url.hostname;
  const path = url.pathname.replace(/^\//, '');
  if (host === 'task' && UUID.test(path)) return { kind: 'task', id: path };
  if (host === 'day' && UUID.test(path)) return { kind: 'day', id: path };
  if (host === 'today' || path === 'today') return { kind: 'today' };
  return null;
}
