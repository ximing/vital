import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { inboxId, registerUser } from './helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

async function createOutcome(token: string, name: string): Promise<string> {
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/outcomes',
    token,
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

describe('outcomes CRUD', () => {
  it('creates, lists, renames, closes and reopens threads', async () => {
    const alice = await registerUser(app);
    const id = await createOutcome(alice.token, '换工作');

    const list = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/outcomes?status=open',
      token: alice.token,
    });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]).toMatchObject({
      id,
      name: '换工作',
      status: 'open',
      createdBy: 'user',
      openTaskCount: 0,
      materialCount: 0,
    });

    const renamed = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/outcomes/${id}`,
      token: alice.token,
      payload: { name: '换到 AI 公司' },
    });
    expect(renamed.json().name).toBe('换到 AI 公司');

    const closed = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/close`,
      token: alice.token,
    });
    expect(closed.json().status).toBe('closed');
    // Idempotent: closing again stays closed without error.
    const again = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/close`,
      token: alice.token,
    });
    expect(again.json().status).toBe('closed');

    const openList = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/outcomes?status=open',
      token: alice.token,
    });
    expect(openList.json()).toHaveLength(0);

    const reopened = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/reopen`,
      token: alice.token,
    });
    expect(reopened.json().status).toBe('open');
  });

  it('rejects cross-user access and undo of user-created threads', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const id = await createOutcome(alice.token, '家庭');

    const stolen = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/outcomes/${id}`,
      token: bob.token,
      payload: { name: 'x' },
    });
    expect(stolen.statusCode).toBe(404);

    const undo = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/undo`,
      token: alice.token,
    });
    expect(undo.statusCode).toBe(409);
  });
});

describe('task outcomeId', () => {
  it('assigns and moves tasks between threads; rejects foreign outcomeId', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const outcomeId = await createOutcome(alice.token, '换工作');

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '改简历', listId: inbox, outcomeId },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().outcomeId).toBe(outcomeId);
    expect(created.json().deferCount).toBe(0);
    expect(created.json().estimateMinutes).toBeNull();

    const taskId = created.json().id as string;
    const moved = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { outcomeId: null, estimateMinutes: 45 },
    });
    expect(moved.json().outcomeId).toBeNull();
    expect(moved.json().estimateMinutes).toBe(45);

    const bobsOutcome = await createOutcome(bob.token, 'bob 的线程');
    const foreign = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { outcomeId: bobsOutcome },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('inbox items can be filed to a thread as material', async () => {
    const alice = await registerUser(app);
    const outcomeId = await createOutcome(alice.token, 'Todo App');
    const captured = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: 'Linear 的 IA 设计文档' },
    });
    expect(captured.statusCode).toBe(201);
    const itemId = captured.json().id as string;
    expect(captured.json().outcomeId).toBeNull();

    const filed = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/inbox/${itemId}`,
      token: alice.token,
      payload: { outcomeId },
    });
    expect(filed.statusCode).toBe(200);
    expect(filed.json().outcomeId).toBe(outcomeId);

    const outcomes = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/outcomes?status=open',
      token: alice.token,
    });
    expect(outcomes.json()[0].materialCount).toBe(1);
  });
});

describe('GET /api/v1/today', () => {
  it('aggregates outcomes with fresh rule fields, today tasks and the pulse', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const outcomeId = await createOutcome(alice.token, '换工作');
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '改简历', listId: inbox, outcomeId },
    });
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: '未读资料' },
    });

    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/today',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outcomes).toHaveLength(1);
    expect(body.outcomes[0]).toMatchObject({
      id: outcomeId,
      openTaskCount: 1,
      ruleSignal: 'flat',
      ruleNextStep: '改简历',
    });
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(body.pulse.inboxPending).toBe(1);
    expect(body.pulse.reportStreak).toBe(0);
    expect(body.generatedAt).toBeTruthy();
  });

  it('alerts on all-day tasks only from the next local day, timed tasks past the instant', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const today = DateTime.now().setZone('Asia/Shanghai').toISODate()!;
    const yesterday = DateTime.fromISO(today).minus({ days: 1 }).toISODate()!;
    const cases = [
      { name: '全天今天', dueAt: `${today}T00:00:00+08:00`, isAllDay: true, signal: 'flat' },
      { name: '全天昨天', dueAt: `${yesterday}T00:00:00+08:00`, isAllDay: true, signal: 'alert' },
      {
        name: '带时刻已过点',
        dueAt: new Date(Date.now() - 3600_000).toISOString(),
        isAllDay: false,
        signal: 'alert',
      },
    ];
    for (const c of cases) {
      const outcomeId = await createOutcome(alice.token, c.name);
      await injectJson(app, {
        method: 'POST',
        url: '/api/v1/tasks',
        token: alice.token,
        payload: { title: c.name, listId: inbox, outcomeId, dueAt: c.dueAt, isAllDay: c.isAllDay },
      });
    }

    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/today',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const byName = new Map(res.json().outcomes.map((o: { name: string; ruleSignal: string }) => [o.name, o.ruleSignal]));
    expect(byName.get('全天今天')).toBe('flat');
    expect(byName.get('全天昨天')).toBe('alert');
    expect(byName.get('带时刻已过点')).toBe('alert');
  });

  it('requires auth', async () => {
    const res = await injectJson(app, { method: 'GET', url: '/api/v1/today' });
    expect(res.statusCode).toBe(401);
  });
});
