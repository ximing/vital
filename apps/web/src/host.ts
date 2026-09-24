export type StickyAlertInput = {
  id: string;
  title: string;
  body: string;
  url: string;
};

export type VitalHost = {
  kind: 'desktop';
  applyChrome(input: { scheme: 'light' | 'dark'; background: string }): void;
  showStickyAlert(input: StickyAlertInput): void;
  listenStickyAlerts(onItem: (input: StickyAlertInput) => void): Promise<() => void>;
  closeStickyAlert(): void;
  openInMain(url: string): void;
};

const HOST_METHODS = [
  'applyChrome',
  'showStickyAlert',
  'listenStickyAlerts',
  'closeStickyAlert',
  'openInMain',
] as const;

function isVitalHost(value: unknown): value is VitalHost {
  if (typeof value !== 'object' || value === null) return false;
  const host = value as Record<string, unknown>;
  if (host.kind !== 'desktop') return false;
  return HOST_METHODS.every((name) => typeof host[name] === 'function');
}

/** Missing host, or a host whose kind is not desktop, is a normal browser. */
export function getVitalHost(
  target: { __VITAL_HOST__?: unknown } | null | undefined = globalThis.window,
): VitalHost | null {
  const host = target?.__VITAL_HOST__;
  return isVitalHost(host) ? host : null;
}

export function isDesktopHost(
  target: { __VITAL_HOST__?: unknown } | null | undefined = globalThis.window,
): boolean {
  return getVitalHost(target) !== null;
}
