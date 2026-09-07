import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
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
      head: { revision: number };
      tasks: { id: string; deletedAt: string | null }[];
      inbox: { id: string; deletedAt: string | null }[];
      reports: { id: string; bodyMd?: string; revision: number }[];
    };
    expect(body.truncated).toBe(false);
    expect(typeof body.serverTime).toBe('string');
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
});
