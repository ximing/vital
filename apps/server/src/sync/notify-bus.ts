import pg from 'pg';
import { pool } from '../db/index.js';
import { logger } from '../utils/logger.js';

/** Websocket rooms are per process. NOTIFY is how the worker reaches the API's sockets. */
const CHANNEL = 'vital_notify';
/** Postgres rejects NOTIFY payloads over 8000 bytes. */
const MAX_PAYLOAD = 7000;

export type NotifyPush = {
  userId: string;
  id: string;
  title: string;
  body: string;
  url: string;
};

type Handler = (message: NotifyPush) => void;

let handler: Handler | null = null;
let client: pg.PoolClient | null = null;
let stopped = true;
let starting: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function parseNotify(raw: string): NotifyPush | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.userId !== 'string' || rec.userId === '') return null;
  if (typeof rec.id !== 'string' || rec.id === '') return null;
  if (typeof rec.title !== 'string') return null;
  if (typeof rec.body !== 'string' || typeof rec.url !== 'string') return null;
  // Absolute and protocol-relative URLs would leave the page's host.
  if (!rec.url.startsWith('/') || rec.url.startsWith('//')) return null;
  return {
    userId: rec.userId,
    id: rec.id,
    title: rec.title,
    body: rec.body,
    url: rec.url,
  };
}

export async function emitNotify(message: NotifyPush): Promise<void> {
  let body = message.body;
  let encoded = JSON.stringify({ ...message, body });
  if (encoded.length > MAX_PAYLOAD) {
    body = body.slice(0, 400);
    encoded = JSON.stringify({ ...message, body });
  }
  await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, encoded]);
}

function drop(held: pg.PoolClient, err?: Error): void {
  if (client === held) client = null;
  held.removeAllListeners();
  try {
    held.release(err);
  } catch {
    // Already released.
  }
}

async function connect(): Promise<void> {
  const held = await pool.connect();
  if (stopped) {
    held.release();
    return;
  }
  client = held;
  held.on('notification', (msg: unknown) => {
    if (typeof msg !== 'object' || msg === null) return;
    const note = msg as { channel?: unknown; payload?: unknown };
    if (note.channel !== CHANNEL || typeof note.payload !== 'string') return;
    const parsed = parseNotify(note.payload);
    if (parsed) handler?.(parsed);
  });
  held.on('error', (err: Error) => {
    logger.error('notify.bus.client', err);
    drop(held, err);
    scheduleReconnect();
  });
  try {
    await held.query(`LISTEN ${CHANNEL}`);
  } catch (err) {
    drop(held, err instanceof Error ? err : new Error('notify listen failed'));
    throw err;
  }
}

function scheduleReconnect(): void {
  if (stopped || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (stopped) return;
    void connect().catch((err: unknown) => {
      logger.error('notify.bus.reconnect', err);
      scheduleReconnect();
    });
  }, 1_000);
}

/** API process only. A checked-out client stays out of the pool's idle timeout. */
export function startNotifyBus(onMessage: Handler): Promise<void> {
  handler = onMessage;
  stopped = false;
  if (!starting) {
    starting = connect().catch((err: unknown) => {
      starting = null;
      scheduleReconnect();
      throw err;
    });
  }
  return starting;
}

export async function stopNotifyBus(): Promise<void> {
  stopped = true;
  starting = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const held = client;
  client = null;
  handler = null;
  if (!held) return;
  held.removeAllListeners();
  try {
    await held.query(`UNLISTEN ${CHANNEL}`);
  } catch {
    // The connection is already gone.
  }
  try {
    held.release();
  } catch {
    // Already released.
  }
}
