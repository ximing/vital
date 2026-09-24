import { getVitalHost } from '@/host';

export const STICKY_ALERT_HASH_PREFIX = '#vital-alert=';
export const STICKY_ALERT_PREF_KEY = 'vital:sticky-alert';
export const STICKY_ALERT_WIDTH = 360;
export const STICKY_ALERT_HEIGHT = 162;
const MARGIN = 16;

export type StickyAlertPayload = {
  id: string;
  title: string;
  body: string;
  url: string;
};

export function readStickyAlertPref(): boolean {
  try {
    return localStorage.getItem(STICKY_ALERT_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeStickyAlertPref(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(STICKY_ALERT_PREF_KEY, '1');
    else localStorage.removeItem(STICKY_ALERT_PREF_KEY);
  } catch {
    // Private mode / blocked storage.
  }
}

export function isNotifyAlertRuntime(
  target: { location?: { hash?: string } } | null | undefined = globalThis.window,
): boolean {
  const hash = target?.location?.hash;
  return typeof hash === 'string' && hash.startsWith(STICKY_ALERT_HASH_PREFIX);
}

export function asStickyAlertPayload(raw: unknown): StickyAlertPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== 'string' || value.id === '') return null;
  if (typeof value.title !== 'string') return null;
  return {
    id: value.id,
    title: value.title,
    body: typeof value.body === 'string' ? value.body : '',
    url: typeof value.url === 'string' && value.url !== '' ? value.url : '/today',
  };
}

export function parseStickyAlertHash(hash: string): StickyAlertPayload | null {
  if (!hash.startsWith(STICKY_ALERT_HASH_PREFIX)) return null;
  try {
    return asStickyAlertPayload(
      JSON.parse(decodeURIComponent(hash.slice(STICKY_ALERT_HASH_PREFIX.length))),
    );
  } catch {
    return null;
  }
}

export function encodeStickyAlertHash(payload: StickyAlertPayload): string {
  return `${STICKY_ALERT_HASH_PREFIX}${encodeURIComponent(JSON.stringify(payload))}`;
}

export function stickyAlertPosition(
  work: { x: number; y: number; width: number; height: number },
  width = STICKY_ALERT_WIDTH,
  height = STICKY_ALERT_HEIGHT,
  margin = MARGIN,
): { x: number; y: number } {
  const x = Math.round(Math.max(work.x + margin, work.x + work.width - width - margin));
  const y = Math.round(
    Math.max(work.y, Math.min(work.y + margin, work.y + work.height - height - margin)),
  );
  return { x, y };
}

export function showStickyAlert(payload: StickyAlertPayload): Promise<void> {
  getVitalHost()?.showStickyAlert(payload);
  return Promise.resolve();
}

export function listenStickyAlerts(
  onItem: (item: StickyAlertPayload) => void,
): Promise<() => void> {
  const host = getVitalHost();
  if (!host) return Promise.resolve(() => undefined);
  return host.listenStickyAlerts((input) => {
    const item = asStickyAlertPayload(input);
    if (item) onItem(item);
  });
}

export function dismissStickyAlertWindow(): void {
  getVitalHost()?.closeStickyAlert();
}

export function openStickyAlertTarget(url: string): void {
  getVitalHost()?.openInMain(url);
}

export function resetStickyAlertForTest(): void {
  writeStickyAlertPref(false);
}
