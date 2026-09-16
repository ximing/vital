import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { nextSyncSince, syncEventsUrl } from '@vital/api-client';
import type { SyncChanges } from '@vital/dto';
import { apiUrl, client } from './api';
import { localDateStamp } from './format';
import { secureTokenStore } from './token-store';

const HEAD_POLL_MS = 15_000;
const SNAPSHOT_MS = 60_000;
const MAX_PAGES = 8;

type Listener = (changes: SyncChanges) => void;
const listeners = new Set<Listener>();

/** Day-scoped screens (today/habits/reports) must refetch; incremental sync has no rows at midnight. */
export type SnapshotReason = 'day' | 'periodic' | 'foreground';
type SnapshotListener = (reason: SnapshotReason) => void;
const snapshotListeners = new Set<SnapshotListener>();

let stopped = true;
let cursor: string | null = null;
let socket: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let snapshotTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let appSub: NativeEventSubscription | null = null;
let inFlight: Promise<SyncChanges | null> | null = null;
let backoff = 1_000;
let lastLocalDay: string | null = null;

function deviceDay(at = new Date()): string {
  return localDateStamp(Intl.DateTimeFormat().resolvedOptions().timeZone, at);
}

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeSnapshot(listener: SnapshotListener): () => void {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

function notifySnapshot(reason: SnapshotReason): void {
  for (const listener of snapshotListeners) listener(reason);
}

function consumeDayRollover(at = new Date()): boolean {
  const day = deviceDay(at);
  if (lastLocalDay === null) {
    lastLocalDay = day;
    return false;
  }
  if (day === lastLocalDay) return false;
  lastLocalDay = day;
  return true;
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
      nextSince: cursor,
    };
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const page = await client.syncChanges({ since: cursor });
      acc.tasks.push(...page.tasks);
      acc.inbox.push(...page.inbox);
      acc.reports.push(...page.reports);
      acc.head = page.head;
      acc.serverTime = page.serverTime;
      acc.nextSince = page.nextSince;
      cursor = nextSyncSince(page);
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

function tickPoll(): void {
  void pullSync().catch(() => undefined);
  if (consumeDayRollover()) notifySnapshot('day');
}

function startSnapshotTimer(): void {
  if (snapshotTimer || stopped) return;
  snapshotTimer = setInterval(() => {
    if (consumeDayRollover()) {
      notifySnapshot('day');
      return;
    }
    notifySnapshot('periodic');
  }, SNAPSHOT_MS);
}

function stopSnapshotTimer(): void {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
}

function onAppState(state: AppStateStatus): void {
  if (state === 'active') {
    void pullSync().catch(() => undefined);
    notifySnapshot(consumeDayRollover() ? 'day' : 'foreground');
    startSnapshotTimer();
    if (!socket) connectWs();
    return;
  }
  stopSnapshotTimer();
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
  lastLocalDay = deviceDay();
  void pullSync().catch(() => undefined);
  pollTimer = setInterval(() => {
    tickPoll();
  }, HEAD_POLL_MS);
  startSnapshotTimer();
  connectWs();
  appSub = AppState.addEventListener('change', onAppState);
}

export function stopMobileSync(): void {
  stopped = true;
  cursor = null;
  inFlight = null;
  backoff = 1_000;
  lastLocalDay = null;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  stopSnapshotTimer();
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
