import { randomUUID } from 'node:crypto';
import {
  decodeSyncCursor,
  SYNC_CURSOR_OVERLAP_MS,
  type SyncChanges,
} from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { getDb } from '../src/db/index.js';
import { tasks } from '../src/db/schema.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { inboxId, registerUser } from './helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
  await app.ready();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

const EPOCH = '1970-01-01T00:00:00.000Z';

function parseMsg(data: unknown): unknown {
  return JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data)) as unknown;
}

function waitForMsg(
  ws: { on: (ev: string, cb: (data: unknown) => void) => void; off: (ev: string, cb: (data: unknown) => void) => void },
  pred: (msg: unknown) => boolean,
  ms = 2_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('websocket message timeout'));
    }, ms);
    const onMsg = (data: unknown) => {
      const msg = parseMsg(data);
      if (!pred(msg)) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      resolve(msg);
    };
    ws.on('message', onMsg);
  });
}

describe('sync', () => {
  it('GET /sync/head and /sync/changes require auth and a parseable since', async () => {
    const anonHead = await injectJson(app, { method: 'GET', url: '/api/v1/sync/head' });
    expect(anonHead.statusCode).toBe(401);
    const anonChanges = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/sync/changes?since=${EPOCH}`,
    });
    expect(anonChanges.statusCode).toBe(401);

    const alice = await registerUser(app);
    const missing = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/sync/changes',
      token: alice.token,
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns created tasks, inbox tombstones, and report list items without bodyMd', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app, 'bob');
    const inbox = await inboxId(app, alice.token);

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Sync me', listId: inbox },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as string;

    const note = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'clip', source: 'manual' },
    });
    expect(note.statusCode).toBe(201);
    const inboxIdValue = note.json().id as string;
    const deleted = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/inbox/${inboxIdValue}`,
      token: alice.token,
    });
    expect(deleted.statusCode).toBe(204);

    const report = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=daily',
      token: alice.token,
    });
    expect(report.statusCode).toBe(200);

    const bobTask = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: bob.token,
      payload: { title: 'Bob only', listId: await inboxId(app, bob.token) },
    });
    expect(bobTask.statusCode).toBe(201);

    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/sync/changes?since=${EPOCH}`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      serverTime: string;
      truncated: boolean;
      nextSince: string;
      head: { revision: number };
      tasks: { id: string; deletedAt: string | null }[];
      inbox: { id: string; deletedAt: string | null }[];
      reports: { id: string; bodyMd?: string; revision: number }[];
    };
    expect(body.truncated).toBe(false);
    expect(typeof body.serverTime).toBe('string');
    expect(body.nextSince.startsWith('s1|')).toBe(true);
    expect(decodeSyncCursor(body.nextSince)).not.toBeNull();
    expect(body.head.revision).toBeGreaterThan(0);
    expect(body.tasks.map((row) => row.id)).toContain(taskId);
    expect(body.tasks.map((row) => row.id)).not.toContain(bobTask.json().id);
    const tombstone = body.inbox.find((row) => row.id === inboxIdValue);
    expect(tombstone?.deletedAt).toBeTruthy();
    expect(body.reports.some((row) => row.id === report.json().id)).toBe(true);
    expect(body.reports[0]).not.toHaveProperty('bodyMd');
  });

  it('sets truncated when a collection exceeds limit', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    for (const title of ['one', 'two']) {
      const created = await injectJson(app, {
        method: 'POST',
        url: '/api/v1/tasks',
        token: alice.token,
        payload: { title, listId: inbox },
      });
      expect(created.statusCode).toBe(201);
    }
    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/sync/changes?since=${EPOCH}&limit=1`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { truncated: boolean; tasks: unknown[] };
    expect(body.truncated).toBe(true);
    expect(body.tasks).toHaveLength(1);
  });

  it('websocket hello then invalidate after a task write', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const ws = await app.injectWS('/api/v1/sync/events');
    const ready = waitForMsg(
      ws,
      (msg) => typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'ready',
    );
    ws.send(JSON.stringify({ type: 'hello', token: alice.token }));
    await ready;
    const invalidated = waitForMsg(
      ws,
      (msg) =>
        typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'invalidate',
    );
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'ping', listId: inbox },
    });
    expect(created.statusCode).toBe(201);
    await invalidated;
    ws.terminate();
  });

  it('pages 320 same-millisecond rows without loss or duplicates', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const stamped = new Date('2026-03-01T12:00:00.000Z');
    const ids = Array.from({ length: 320 }, () => randomUUID());
    await getDb()
      .insert(tasks)
      .values(
        ids.map((id, i) => ({
          id,
          userId: alice.id,
          listId,
          title: `row-${i}`,
          timezone: 'UTC',
          sortOrder: i,
          createdAt: stamped,
          updatedAt: stamped,
        })),
      );

    const seen: string[] = [];
    let since = EPOCH;
    for (let page = 0; page < 20; page += 1) {
      const res = await injectJson(app, {
        method: 'GET',
        url: `/api/v1/sync/changes?since=${encodeURIComponent(since)}&limit=80`,
        token: alice.token,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as SyncChanges;
      seen.push(...body.tasks.map((row) => row.id));
      since = body.nextSince;
      if (!body.truncated) break;
      expect(page).toBeLessThan(19);
    }
    expect(seen).toHaveLength(320);
    expect(new Set(seen).size).toBe(320);
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it('overlap window on nextSince catches a slow-commit row', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const first = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/sync/changes?since=${new Date().toISOString()}`,
      token: alice.token,
    });
    expect(first.statusCode).toBe(200);
    const page = first.json() as SyncChanges;
    const cursor = decodeSyncCursor(page.nextSince);
    expect(cursor).not.toBeNull();
    if (cursor === null) throw new Error('expected nextSince cursor');
    expect(Date.parse(page.serverTime) - Date.parse(cursor.tasks.ts)).toBe(SYNC_CURSOR_OVERLAP_MS);

    const serverTime = new Date(page.serverTime);
    const lateId = randomUUID();
    const tooOldId = randomUUID();
    await getDb()
      .insert(tasks)
      .values([
        {
          id: lateId,
          userId: alice.id,
          listId,
          title: 'slow commit',
          timezone: 'UTC',
          createdAt: new Date(serverTime.getTime() - 5_000),
          updatedAt: new Date(serverTime.getTime() - 5_000),
        },
        {
          id: tooOldId,
          userId: alice.id,
          listId,
          title: 'outside overlap',
          timezone: 'UTC',
          createdAt: new Date(serverTime.getTime() - 15_000),
          updatedAt: new Date(serverTime.getTime() - 15_000),
        },
      ]);

    const second = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/sync/changes?since=${encodeURIComponent(page.nextSince)}`,
      token: alice.token,
    });
    expect(second.statusCode).toBe(200);
    const pulled = (second.json() as SyncChanges).tasks.map((row) => row.id);
    expect(pulled).toContain(lateId);
    expect(pulled).not.toContain(tooOldId);
  });

  it('accepts the opaque cursor from a previous page and rejects a malformed one', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'keep', listId },
    });
    expect(created.statusCode).toBe(201);

    const iso = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/sync/changes?since=${EPOCH}`,
      token: alice.token,
    });
    expect(iso.statusCode).toBe(200);
    const nextSince = (iso.json() as SyncChanges).nextSince;
    expect(nextSince.startsWith('s1|')).toBe(true);

    const follow = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/sync/changes?since=${encodeURIComponent(nextSince)}`,
      token: alice.token,
    });
    expect(follow.statusCode).toBe(200);

    const bad = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/sync/changes?since=s1%7Cnot-a-cursor',
      token: alice.token,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
  });
});
