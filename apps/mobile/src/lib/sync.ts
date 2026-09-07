import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { latestUpdatedAt, syncEventsUrl } from '@vital/api-client';
import type { SyncChanges } from '@vital/dto';
import { apiUrl, client } from './api';
import { secureTokenStore } from './token-store';

const HEAD_POLL_MS = 15_000;
const MAX_PAGES = 8;

type Listener = (changes: SyncChanges) => void;
const listeners = new Set<Listener>();

let stopped = true;
let cursor: string | null = null;
let socket: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let appSub: NativeEventSubscription | null = null;
let inFlight: Promise<SyncChanges | null> | null = null;
let backoff = 1_000;

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(changes: SyncChanges): void {
  if (changes.tasks.length === 0 && changes.inbox.length === 0 && changes.reports.length === 0) {
    return;
  }
  for (const listener of listeners) listener(changes);
}

export async function pullSync(): Promise<SyncChanges | null> {
  if (stopped) return null;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (cursor === null) {
      cursor = new Date().toISOString();
      return null;
    }
    const acc: SyncChanges = {
      serverTime: cursor,
      head: {
        tasksMaxUpdatedAt: null,
        inboxMaxUpdatedAt: null,
        reportsMaxUpdatedAt: null,
        revision: 0,
      },
      tasks: [],
      inbox: [],
      reports: [],
      truncated: false,
    };
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const page = await client.syncChanges({ since: cursor });
      acc.tasks.push(...page.tasks);
      acc.inbox.push(...page.inbox);
      acc.reports.push(...page.reports);
      acc.head = page.head;
      acc.serverTime = page.serverTime;
      cursor = page.truncated ? (latestUpdatedAt(page) ?? page.serverTime) : page.serverTime;
      if (!page.truncated) {
        acc.truncated = false;
        break;
      }
      acc.truncated = true;
    }
    notify(acc);
    return acc;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  const delay = backoff;
  backoff = Math.min(backoff * 2, 15_000);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, delay);
}

function connectWs(): void {
  if (stopped) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(syncEventsUrl(apiUrl));
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    void Promise.resolve(secureTokenStore.getAccessToken()).then((token) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!token) {
        ws.close();
        return;
      }
      ws.send(JSON.stringify({ type: 'hello', token }));
    });
  };
  ws.onmessage = (ev) => {
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
    if (type === 'invalidate') void pullSync().catch(() => undefined);
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (!stopped) scheduleReconnect();
  };
  ws.onerror = () => {
    ws.close();
  };
}

function onAppState(state: AppStateStatus): void {
  if (state === 'active') {
    void pullSync().catch(() => undefined);
    if (!socket) connectWs();
    return;
  }
  if (socket) {
    const live = socket;
    socket = null;
    live.close();
  }
}

export function startMobileSync(): void {
  if (!stopped) return;
  stopped = false;
  backoff = 1_000;
  void pullSync().catch(() => undefined);
  pollTimer = setInterval(() => {
    void pullSync().catch(() => undefined);
  }, HEAD_POLL_MS);
  connectWs();
  appSub = AppState.addEventListener('change', onAppState);
}

export function stopMobileSync(): void {
  stopped = true;
  cursor = null;
  inFlight = null;
  backoff = 1_000;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (appSub) {
    appSub.remove();
    appSub = null;
  }
  if (socket) {
    const live = socket;
    socket = null;
    live.close();
  }
}
