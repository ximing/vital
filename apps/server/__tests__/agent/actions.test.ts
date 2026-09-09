import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, habits, outcomes } from '../../src/db/schema.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { inboxId, registerUser } from '../helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

async function createTask(token: string, title: string): Promise<string> {
  const inbox = await inboxId(app, token);
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/tasks',
    token,
    payload: { title, listId: inbox },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function seedAction(input: {
  userId: string;
  targetId: string;
  actionType?: string;
  targetType?: string;
  feedback?: 'pending' | 'accepted' | 'edited' | 'dismissed';
  payload?: Record<string, unknown>;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(agentActions)
    .values({
      id,
      userId: input.userId,
      actionType: input.actionType ?? 'task.decompose',
      targetType: input.targetType ?? 'task',
      targetId: input.targetId,
      payload: input.payload ?? { subtasks: [{ title: '第一步', estimateMinutes: 15 }] },
      feedback: input.feedback ?? 'pending',
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    });
  return id;
}

describe('GET /api/v1/agent/actions', () => {
  it('lists the caller’s pending decompose actions for a task', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '写季度总结');
    const actionId = await seedAction({
      userId: alice.id,
      targetId: taskId,
      payload: {
        subtasks: [
          { title: '列大纲', estimateMinutes: 15 },
          { title: '填数据', estimateMinutes: 30 },
        ],
        deferCount: 3,
      },
    });
    await seedAction({ userId: alice.id, targetId: taskId, feedback: 'dismissed' });

    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/agent/actions?targetType=task&targetId=${taskId}&feedback=pending`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(actionId);
    expect(body[0].actionType).toBe('task.decompose');
    expect(body[0].targetType).toBe('task');
    expect(body[0].targetId).toBe(taskId);
    expect(body[0].feedback).toBe('pending');
    expect(body[0].payload.subtasks).toHaveLength(2);
    expect(typeof body[0].createdAt).toBe('string');
  });

  it('never leaks another user’s actions', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const taskId = await createTask(alice.token, 'alice 的任务');
    await seedAction({ userId: alice.id, targetId: taskId });

    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/agent/actions?targetType=task&targetId=${taskId}&feedback=pending`,
      token: bob.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);

    const all = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/actions',
      token: bob.token,
    });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toEqual([]);
  });

  it('rejects invalid filters and missing auth', async () => {
    const alice = await registerUser(app, 'alice');
    const bad = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/actions?targetType=nope',
      token: alice.token,
    });
    expect(bad.statusCode).toBe(400);

    const badId = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/actions?targetId=not-a-uuid',
      token: alice.token,
    });
    expect(badId.statusCode).toBe(400);

    const anon = await injectJson(app, { method: 'GET', url: '/api/v1/agent/actions' });
    expect(anon.statusCode).toBe(401);
  });
});

describe('GET /api/v1/agent/actions?days (activity log)', () => {
  it('returns enriched log items: joined target names, payload digests, desc order', async () => {
    const alice = await registerUser(app, 'alice');
    const now = Date.now();
    const minutes = (n: number) => new Date(now - n * 60 * 1000);

    // Soft-deleted task — the title should still resolve.
    const taskId = await createTask(alice.token, '写季度总结');
    const del = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
    });
    expect(del.statusCode).toBe(204);

    const outcomeId = randomUUID();
    await getDb()
      .insert(outcomes)
      .values({ id: outcomeId, userId: alice.id, name: '梳理 Q4 采购' });

    // Hard-deleted habit — the target is gone, targetName must degrade to null.
    const habitId = randomUUID();
    await getDb().insert(habits).values({
      id: habitId,
      userId: alice.id,
      name: '每日复盘',
      kind: 'daily',
    });
    await getDb().delete(habits).where(eq(habits.id, habitId));

    const headlineId = await seedAction({
      userId: alice.id,
      targetId: outcomeId,
      actionType: 'outcome.headline',
      targetType: 'outcome',
      payload: { headline: '进展顺利，本周收尾' },
      createdAt: minutes(1),
    });
    const decomposeId = await seedAction({
      userId: alice.id,
      targetId: taskId,
      actionType: 'task.decompose',
      payload: {
        subtasks: [
          { title: '列大纲', estimateMinutes: 15 },
          { title: '填数据', estimateMinutes: 30 },
        ],
        deferCount: 2,
      },
      createdAt: minutes(2),
    });
    await seedAction({
      userId: alice.id,
      targetId: habitId,
      actionType: 'habit.nudge',
      targetType: 'habit',
      payload: { content: '记得打卡' },
      feedback: 'accepted',
      createdAt: minutes(3),
    });

    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/actions?days=7',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(3);

    // Newest first.
    expect(body[0].id).toBe(headlineId);
    expect(body[1].id).toBe(decomposeId);

    // Joined names + digests + base fields.
    expect(body[0].targetType).toBe('outcome');
    expect(body[0].targetName).toBe('梳理 Q4 采购');
    expect(body[0].payloadSummary).toBe('进展顺利，本周收尾');
    expect(body[1].targetName).toBe('写季度总结'); // soft-deleted, name still readable
    expect(body[1].payloadSummary).toBe('列大纲、填数据');
    expect(body[2].targetName).toBeNull();
    expect(body[2].payloadSummary).toBe('记得打卡');
    expect(body[0].feedback).toBe('pending');
    expect(body[0].feedbackPayload).toBeNull();
    expect(typeof body[0].createdAt).toBe('string');
  });

  it('clamps days to 1..90 and leaves the window off when absent', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '老任务');
    const oldId = await seedAction({
      userId: alice.id,
      targetId: taskId,
      createdAt: new Date(Date.now() - 100 * 24 * 3600 * 1000),
    });
    await seedAction({ userId: alice.id, targetId: taskId });

    // days=200 clamps to 90 → the 100-day-old row is out of the window.
    const clamped = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/actions?days=200',
      token: alice.token,
    });
    expect(clamped.statusCode).toBe(200);
    expect(clamped.json()).toHaveLength(1);
    expect(clamped.json()[0].id).not.toBe(oldId);

    // No days → no time window, the old row is back (limit still applies).
    const all = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/actions',
      token: alice.token,
    });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toHaveLength(2);

    const zero = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/actions?days=0',
      token: alice.token,
    });
    expect(zero.statusCode).toBe(400);
  });

  it('undoOutcome settles outcome.create as dismissed with a deleted target', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = randomUUID();
    await getDb()
      .insert(outcomes)
      .values({
        id: outcomeId,
        userId: alice.id,
        name: 'Agent 起的线程',
        createdBy: 'agent',
        undoUntil: new Date(Date.now() + 3600 * 1000),
      });
    const actionId = await seedAction({
      userId: alice.id,
      targetId: outcomeId,
      actionType: 'outcome.create',
      targetType: 'outcome',
      payload: { name: 'Agent 起的线程', taskIds: [], headline: '' },
    });

    const undo = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/undo`,
      token: alice.token,
    });
    expect(undo.statusCode).toBe(200);

    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/actions?targetType=outcome',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const [item] = res.json();
    expect(item.id).toBe(actionId);
    expect(item.feedback).toBe('dismissed'); // the UI derives「已撤销」from outcome.create + dismissed
    expect(item.targetName).toBeNull();
    expect(item.payloadSummary).toBe('Agent 起的线程');
  });

  it('settling a pending action via the feedback endpoint is reflected in the log', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '待处理任务');
    const actionId = await seedAction({ userId: alice.id, targetId: taskId });

    const feedback = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${actionId}/feedback`,
      token: alice.token,
      payload: { feedback: 'accepted' },
    });
    expect(feedback.statusCode).toBe(200);
    expect(feedback.json().feedback).toBe('accepted');

    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/actions',
      token: alice.token,
    });
    expect(res.json()[0].feedback).toBe('accepted');
    expect(res.json()[0].feedbackPayload).toBeNull();
  });
});
