import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { agentActions } from '../../src/db/schema.js';
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

async function insertAction(input: {
  userId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  payload?: Record<string, unknown>;
  feedback?: string;
}): Promise<string> {
  const id = randomUUID();
  await db.insert(agentActions).values({
    id,
    userId: input.userId,
    actionType: input.actionType,
    targetType: input.targetType,
    targetId: input.targetId,
    payload: input.payload ?? {},
    feedback: input.feedback ?? 'pending',
  });
  return id;
}

describe('GET /api/v1/outcomes/:id/detail', () => {
  it('aggregates the outcome, its tasks, materials and agent timeline', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const outcomeId = await createOutcome(alice.token, '换工作');

    const openTask = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '简历最后一轮校对', listId, outcomeId, estimateMinutes: 40 },
    });
    expect(openTask.statusCode).toBe(201);
    const doneTask = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '整理项目经历', listId, outcomeId },
    });
    expect(doneTask.statusCode).toBe(201);
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${doneTask.json().id}/complete`,
      token: alice.token,
    });
    // A task on another thread must not leak into the detail.
    const other = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '不相关的事', listId },
    });
    expect(other.statusCode).toBe(201);

    const material = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: '简历反馈要点' },
    });
    expect(material.statusCode).toBe(201);
    const attached = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/inbox/${material.json().id}`,
      token: alice.token,
      payload: { outcomeId },
    });
    expect(attached.statusCode).toBe(200);

    await insertAction({
      userId: alice.id,
      actionType: 'outcome.headline',
      targetType: 'outcome',
      targetId: outcomeId,
      payload: { headline: '本周已推进两步。' },
      feedback: 'accepted',
    });
    const pendingActionId = await insertAction({
      userId: alice.id,
      actionType: 'task.decompose',
      targetType: 'task',
      targetId: openTask.json().id as string,
      payload: { subtasks: [{ title: '校对' }, { title: '回复内推' }] },
    });

    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${outcomeId}/detail`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.outcome).toMatchObject({
      id: outcomeId,
      name: '换工作',
      status: 'open',
      openTaskCount: 1,
      materialCount: 1,
    });

    const titles = body.tasks.map((task: { title: string }) => task.title);
    expect(titles).toContain('简历最后一轮校对');
    expect(titles).toContain('整理项目经历');
    expect(titles).not.toContain('不相关的事');
    const done = body.tasks.find((task: { title: string }) => task.title === '整理项目经历');
    expect(done.status).toBe('done');

    expect(body.materials).toHaveLength(1);
    expect(body.materials[0]).toMatchObject({ title: '简历反馈要点' });
    expect(body.materials[0].extractedHtml).toBeUndefined();

    expect(body.agentActions).toHaveLength(2);
    // Newest first.
    expect(body.agentActions[0].id).toBe(pendingActionId);
    expect(body.agentActions[0].payloadSummary).toBe('校对、回复内推');
    expect(body.agentActions[0].targetName).toBe('简历最后一轮校对');
    expect(body.agentActions[1].feedback).toBe('accepted');
    expect(body.agentActions[1].payloadSummary).toBe('本周已推进两步。');
    expect(body.agentActions[1].targetName).toBe('换工作');
  });

  it('returns 404 for missing or foreign threads', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const outcomeId = await createOutcome(alice.token, '家庭');

    const foreign = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${outcomeId}/detail`,
      token: bob.token,
    });
    expect(foreign.statusCode).toBe(404);

    const missing = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${randomUUID()}/detail`,
      token: alice.token,
    });
    expect(missing.statusCode).toBe(404);

    const anonymous = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${outcomeId}/detail`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('keeps serving detail for a closed thread', async () => {
    const alice = await registerUser(app);
    const outcomeId = await createOutcome(alice.token, '阅读');
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/close`,
      token: alice.token,
    });
    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${outcomeId}/detail`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome.status).toBe('closed');
  });
});
