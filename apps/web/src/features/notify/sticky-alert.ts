import { isTauriRuntime } from '@/api/client';

export const STICKY_ALERT_LABEL = 'notify-alert';
export const STICKY_ALERT_EVENT = 'vital://sticky-alert';
export const OPEN_NOTIFY_EVENT = 'vital://open-notify';
export const STICKY_ALERT_HASH_PREFIX = '#vital-alert=';
export const STICKY_ALERT_PREF_KEY = 'vital:sticky-alert';
export const STICKY_ALERT_WIDTH = 420;
export const STICKY_ALERT_HEIGHT = 212;
const MARGIN = 16;

export type StickyAlertPayload = {
  id: string;
  title: string;
  body: string;
  url: string;
};

type LogicalPoint = { x: number; y: number };
type LogicalSize = { width: number; height: number };

export type StickyAlertWindow = {
  once: (event: string, handler: (event?: { payload?: unknown }) => void) => void;
  show: () => Promise<void>;
  unminimize: () => Promise<void>;
  setFocus: () => Promise<void>;
  setAlwaysOnTop: (value: boolean) => Promise<void>;
  requestUserAttention: (value: unknown) => Promise<void>;
  close: () => Promise<void>;
};

type TauriBits = {
  WebviewWindow: {
    new (label: string, options: Record<string, unknown>): StickyAlertWindow;
    getByLabel: (label: string) => Promise<StickyAlertWindow | null>;
    getCurrent: () => StickyAlertWindow;
  };
  currentMonitor: () => Promise<{
    scaleFactor: number;
    workArea: {
      position: { toLogical: (scale: number) => LogicalPoint };
      size: { toLogical: (scale: number) => LogicalSize };
    };
  } | null>;
  UserAttentionType: { Critical: number };
  emitTo: (target: string, event: string, payload: unknown) => Promise<void>;
  listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void>;
};

let loadTauriImpl: () => Promise<TauriBits | null> = defaultLoadTauri;
let pending: StickyAlertPayload[] = [];
let live: StickyAlertWindow | null = null;
let creating = false;
let chain: Promise<void> = Promise.resolve();
let bridgeUnlisten: (() => void) | null = null;

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

function upsert(items: StickyAlertPayload[], next: StickyAlertPayload): StickyAlertPayload[] {
  if (items.some((item) => item.id === next.id)) return items;
  return [...items, next];
}

async function defaultLoadTauri(): Promise<TauriBits | null> {
  if (!isTauriRuntime() || window.__TAURI_INTERNALS__ === undefined) return null;
  try {
    const [webview, windowMod, eventMod] = await Promise.all([
      import('@tauri-apps/api/webviewWindow'),
      import('@tauri-apps/api/window'),
      import('@tauri-apps/api/event'),
    ]);
    return {
      WebviewWindow: webview.WebviewWindow,
      currentMonitor: windowMod.currentMonitor,
      UserAttentionType: windowMod.UserAttentionType,
      emitTo: eventMod.emitTo,
      listen: eventMod.listen,
    } as TauriBits;
  } catch {
    return null;
  }
}

async function loadTauri(): Promise<TauriBits | null> {
  return loadTauriImpl();
}

async function focusAlert(win: StickyAlertWindow, tauri: TauriBits): Promise<void> {
  await win.unminimize();
  await win.show();
  await win.setAlwaysOnTop(true);
  await win.setFocus();
  await win.requestUserAttention(tauri.UserAttentionType.Critical);
}

async function placement(tauri: TauriBits): Promise<{ x: number; y: number } | undefined> {
  try {
    const monitor = await tauri.currentMonitor();
    if (!monitor) return undefined;
    const scale = monitor.scaleFactor;
    const origin = monitor.workArea.position.toLogical(scale);
    const size = monitor.workArea.size.toLogical(scale);
    return stickyAlertPosition({
      x: origin.x,
      y: origin.y,
      width: size.width,
      height: size.height,
    });
  } catch {
    return undefined;
  }
}

async function flushPending(tauri: TauriBits): Promise<void> {
  for (const item of pending) {
    await tauri.emitTo(STICKY_ALERT_LABEL, STICKY_ALERT_EVENT, item);
  }
}

function rememberWindow(win: StickyAlertWindow): void {
  live = win;
  win.once('tauri://destroyed', () => {
    live = null;
    creating = false;
    pending = [];
  });
}

async function showStickyAlertNow(payload: StickyAlertPayload): Promise<void> {
  const tauri = await loadTauri();
  if (!tauri) return;
  pending = upsert(pending, payload);

  if (!live) {
    live = await tauri.WebviewWindow.getByLabel(STICKY_ALERT_LABEL);
    if (live) rememberWindow(live);
  }
  if (live) {
    await tauri.emitTo(STICKY_ALERT_LABEL, STICKY_ALERT_EVENT, payload);
    await focusAlert(live, tauri);
    return;
  }
  if (creating) return;

  creating = true;
  const pos = await placement(tauri);
  const win = new tauri.WebviewWindow(STICKY_ALERT_LABEL, {
    url: `/${encodeStickyAlertHash(payload)}`,
    title: 'Vital',
    width: STICKY_ALERT_WIDTH,
    height: STICKY_ALERT_HEIGHT,
    minWidth: STICKY_ALERT_WIDTH,
    minHeight: STICKY_ALERT_HEIGHT,
    maxWidth: STICKY_ALERT_WIDTH,
    maxHeight: STICKY_ALERT_HEIGHT,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: true,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    visibleOnAllWorkspaces: true,
    skipTaskbar: true,
    shadow: true,
    focus: true,
    center: pos === undefined,
    x: pos?.x,
    y: pos?.y,
    theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  });
  win.once('tauri://created', () => {
    creating = false;
    rememberWindow(win);
    void flushPending(tauri).then(() => focusAlert(win, tauri));
  });
  win.once('tauri://error', () => {
    creating = false;
    live = null;
  });
}

export function showStickyAlert(payload: StickyAlertPayload): Promise<void> {
  chain = chain.then(
    () => showStickyAlertNow(payload),
    () => showStickyAlertNow(payload),
  );
  return chain;
}

export async function listenStickyAlerts(
  onItem: (item: StickyAlertPayload) => void,
): Promise<() => void> {
  const tauri = await loadTauri();
  if (!tauri) return () => undefined;
  return tauri.listen(STICKY_ALERT_EVENT, (event) => {
    const item = asStickyAlertPayload(event.payload);
    if (item) onItem(item);
  });
}

export async function dismissStickyAlertWindow(): Promise<void> {
  const tauri = await loadTauri();
  if (!tauri) return;
  await tauri.WebviewWindow.getCurrent().close();
}

export async function openStickyAlertTarget(url: string): Promise<void> {
  const tauri = await loadTauri();
  if (!tauri) return;
  await tauri.emitTo('main', OPEN_NOTIFY_EVENT, { url });
}

export async function startStickyAlertBridge(onOpen: (url: string) => void): Promise<void> {
  if (!isTauriRuntime() || bridgeUnlisten) return;
  try {
    const tauri = await loadTauri();
    if (!tauri) return;
    bridgeUnlisten = await tauri.listen(OPEN_NOTIFY_EVENT, (event) => {
      const payload = event.payload;
      const url =
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as { url?: unknown }).url === 'string'
          ? (payload as { url: string }).url
          : null;
      if (url === null) return;
      onOpen(url);
      const main = tauri.WebviewWindow.getCurrent();
      void main
        .unminimize()
        .then(() => main.show())
        .then(() => main.setFocus());
    });
  } catch {
    bridgeUnlisten = null;
  }
}

export function stopStickyAlertBridge(): void {
  bridgeUnlisten?.();
  bridgeUnlisten = null;
}

export function setStickyAlertTauriForTest(loader: (() => Promise<TauriBits | null>) | null): void {
  loadTauriImpl = loader ?? defaultLoadTauri;
}

export function resetStickyAlertForTest(): void {
  loadTauriImpl = defaultLoadTauri;
  pending = [];
  live = null;
  creating = false;
  chain = Promise.resolve();
  stopStickyAlertBridge();
  writeStickyAlertPref(false);
}
