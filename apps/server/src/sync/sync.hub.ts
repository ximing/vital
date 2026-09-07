import { getAuthGate } from '../auth/auth.service.js';
import { verifyAccessToken } from '../auth/token.service.js';
import { AppError } from '../errors.js';
import { shouldPublish } from './sync-publish.js';

/** `ws` socket surface used by @fastify/websocket — avoid depending on `ws` types. */
export type SyncSocket = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  ping: () => void;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  readyState: number;
  OPEN: number;
};

const HELLO_MS = 5_000;
const PING_MS = 25_000;
const COALESCE_MS = 50;

const rooms = new Map<string, Set<SyncSocket>>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function textOf(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return '';
}

function isHello(value: unknown): value is { type: 'hello'; token: string } {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return rec.type === 'hello' && typeof rec.token === 'string' && rec.token.length > 0;
}

async function userIdFromToken(token: string): Promise<string> {
  const { userId, iat } = verifyAccessToken(token);
  const gate = await getAuthGate(userId);
  if (gate.passwordChangedAt && gate.passwordChangedAt.getTime() > iat * 1000) {
    throw AppError.of(401, 'INVALID_TOKEN');
  }
  return gate.id;
}

export function subscribe(userId: string, socket: SyncSocket): void {
  let set = rooms.get(userId);
  if (!set) {
    set = new Set();
    rooms.set(userId, set);
  }
  set.add(socket);
}

export function unsubscribe(userId: string, socket: SyncSocket): void {
  const set = rooms.get(userId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) rooms.delete(userId);
}

export function publishInvalidation(userId: string): void {
  if (!rooms.has(userId)) return;
  const prev = pending.get(userId);
  if (prev) clearTimeout(prev);
  pending.set(
    userId,
    setTimeout(() => {
      pending.delete(userId);
      const payload = JSON.stringify({ type: 'invalidate', at: new Date().toISOString() });
      for (const socket of rooms.get(userId) ?? []) {
        if (socket.readyState === socket.OPEN) socket.send(payload);
      }
    }, COALESCE_MS),
  );
}

export function maybePublish(method: string, url: string, status: number, userId?: string): void {
  if (!shouldPublish(method, url, status, userId)) return;
  if (userId) publishInvalidation(userId);
}

export function attachSyncSocket(socket: unknown): void {
  const conn = socket as SyncSocket;
  let authed = false;
  let userId: string | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const helloTimer = setTimeout(() => {
    if (!authed) conn.close(4408, 'hello timeout');
  }, HELLO_MS);

  const cleanup = (): void => {
    clearTimeout(helloTimer);
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    if (userId) unsubscribe(userId, conn);
  };

  conn.on('close', cleanup);
  conn.on('error', cleanup);

  conn.on('message', (data) => {
    if (authed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(textOf(data)) as unknown;
    } catch {
      conn.close(4400, 'invalid json');
      return;
    }
    if (!isHello(parsed)) {
      conn.close(4400, 'hello required');
      return;
    }
    const token = parsed.token;
    void userIdFromToken(token)
      .then((id) => {
        if (conn.readyState !== conn.OPEN) return;
        authed = true;
        userId = id;
        clearTimeout(helloTimer);
        subscribe(id, conn);
        pingTimer = setInterval(() => {
          if (conn.readyState === conn.OPEN) conn.ping();
        }, PING_MS);
        conn.send(JSON.stringify({ type: 'ready' }));
      })
      .catch(() => {
        conn.close(4401, 'unauthorized');
      });
  });
}
