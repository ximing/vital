import type { QueryClient } from '@tanstack/react-query';
import { latestUpdatedAt, syncEventsUrl, syncHeadMoved } from '@vital/api-client';
import type { SyncChanges, SyncHead } from '@vital/dto';
import { client, isTauriRuntime, tauriBaseUrl, tokenStore } from '@/api/client';
import { applySyncChanges } from './apply-changes';

const HEAD_POLL_MS = 5_000;
const MAX_PAGES = 8;

let running = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let socket: WebSocket | null = null;
let since: string | null = null;
let prevHead: SyncHead | null = null;
let qc: QueryClient | null = null;
let inFlight: Promise<void> | null = null;
let backoff = 1_000;

function eventsUrl(): string {
  if (isTauriRuntime()) return syncEventsUrl(tauriBaseUrl());
  return syncEventsUrl('');
}

async function pullChanges(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (since === null) {
      since = new Date().toISOString();
      return;
    }
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const page: SyncChanges = await client.syncChanges({ since });
      if (qc) applySyncChanges(qc, page);
      since = page.truncated ? (latestUpdatedAt(page) ?? page.serverTime) : page.serverTime;
      prevHead = page.head;
      if (!page.truncated) break;
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function tick(): Promise<void> {
  const head = await client.syncHead();
  if (since === null) {
    since = new Date().toISOString();
    prevHead = head;
    return;
  }
  if (!syncHeadMoved(prevHead, head)) {
    prevHead = head;
    return;
  }
  await pullChanges();
}

function scheduleReconnect(): void {
  if (!running || reconnectTimer) return;
  const delay = backoff;
  backoff = Math.min(backoff * 2, 15_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, delay);
}

function connectWs(): void {
  if (!running || typeof WebSocket === 'undefined') return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(eventsUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;
  ws.addEventListener('open', () => {
    void Promise.resolve(tokenStore.getAccessToken()).then((token) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!token) {
        ws.close();
        return;
      }
      ws.send(JSON.stringify({ type: 'hello', token }));
    });
  });
  ws.addEventListener('message', (ev) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(ev.data)) as unknown;
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const type = (parsed as { type?: unknown }).type;
    if (type === 'ready') {
      backoff = 1_000;
      return;
    }
    if (type === 'invalidate') void pullChanges().catch(() => undefined);
  });
  ws.addEventListener('close', () => {
    if (socket === ws) socket = null;
    if (running) scheduleReconnect();
  });
  ws.addEventListener('error', () => {
    ws.close();
  });
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') void tick().catch(() => undefined);
}

function onOnline(): void {
  void tick().catch(() => undefined);
  if (!socket) connectWs();
}

export function startSync(queryClient: QueryClient): void {
  if (running) return;
  running = true;
  qc = queryClient;
  backoff = 1_000;
  void tick().catch(() => undefined);
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    void tick().catch(() => undefined);
  }, HEAD_POLL_MS);
  connectWs();
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);
}

export function stopSync(): void {
  running = false;
  qc = null;
  since = null;
  prevHead = null;
  inFlight = null;
  backoff = 1_000;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (socket) {
    const live = socket;
    socket = null;
    live.close();
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
  }
}
