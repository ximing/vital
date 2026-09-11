/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, outcomes, tasks } from '../../src/db/schema.js';
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

async function createTask(
  token: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const inbox = await inboxId(app, token);
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/tasks',
    token,
    payload: { title, listId: inbox, ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function seedAction(input: {
  userId: string;
  targetId: string;
  actionType?: string;
  targetType?: string;
  feedback?: 'pending' | 'accepted' | 'edited' | 'dismissed' | 'undone';
  feedbackPayload?: Record<string, unknown> | null;
  payload?: Record<string, unknown>;
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
      payload: input.payload ?? {
        subtasks: [
          { title: '列大纲', estimateMinutes: 15 },
          { title: '填数据', estimateMinutes: 30 },
        ],
        deferCount: 3,
      },
      feedback: input.feedback ?? 'pending',
      ...(input.feedbackPayload !== undefined
        ? { feedbackPayload: input.feedbackPayload }
        : {}),
    });
  return id;
}

async function accept(token: string, actionId: string) {
  return injectJson(app, {
    method: 'POST',
    url: `/api/v1/agent/actions/${actionId}/feedback`,
    token,
    payload: { feedback: 'accepted' },
  });
}

async function undo(token: string, actionId: string) {
  return injectJson(app, {
    method: 'POST',
    url: `/api/v1/agent/actions/${actionId}/undo`,
    token,
  });
}

async function subtasksOf(parentId: string) {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.parentId, parentId))
    .orderBy(asc(tasks.sortOrder));
}

describe('POST /api/v1/agent/actions/:id/feedback — task.decompose materialization', () => {
  it('accepted materializes all subtasks in one transaction and records materialized.taskIds', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = randomUUID();
    await getDb().insert(outcomes).values({ id: outcomeId, userId: alice.id, name: '换工作' });
    const parent = await createTask(alice.token, '写季度总结', { outcomeId });

    const actionId = await seedAction({ userId: alice.id, targetId: parent });
    const res = await accept(alice.token, actionId);
    expect(res.statusCode).toBe(200);
    expect(res.json().feedback).toBe('accepted');
    expect(res.json().feedbackPayload).toEqual({
      materialized: { taskIds: expect.any(Array) },
    });
    const taskIds = res.json().feedbackPayload.materialized.taskIds as string[];
    expect(taskIds).toHaveLength(2);

    const children = await subtasksOf(parent);
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.id)).toEqual(taskIds);
    // Inheritance: listId / parentId / outcomeId / estimateMinutes, payload order kept.
    for (const child of children) {
      expect(child.parentId).toBe(parent);
      expect(child.outcomeId).toBe(outcomeId);
      expect(child.listId).not.toBeNull();
    }
    expect(children[0]?.title).toBe('列大纲');
    expect(children[0]?.estimateMinutes).toBe(15);
    expect(children[1]?.title).toBe('填数据');
    expect(children[1]?.estimateMinutes).toBe(30);

    const [row] = await getDb().select().from(agentActions).where(eq(agentActions.id, actionId));
    expect(row!.feedback).toBe('accepted');
    expect(row!.feedbackPayload).toEqual({ materialized: { taskIds } });
  });

  it('subtasks without estimateMinutes are created with null estimate', async () => {
    const alice = await registerUser(app, 'alice');
    const parent = await createTask(alice.token, '写初稿');
    const actionId = await seedAction({
      userId: alice.id,
      targetId: parent,
      payload: { subtasks: [{ title: '自由发挥' }] },
    });
    const res = await accept(alice.token, actionId);
    expect(res.statusCode).toBe(200);
    const children = await subtasksOf(parent);
    expect(children).toHaveLength(1);
    expect(children[0]?.estimateMinutes).toBeNull();
  });

  it('repeat accept returns 409 and creates no second batch', async () => {
    const alice = await registerUser(app, 'alice');
    const parent = await createTask(alice.token, '写季度总结');
    const actionId = await seedAction({ userId: alice.id, targetId: parent });

    const first = await accept(alice.token, actionId);
    expect(first.statusCode).toBe(200);
    const second = await accept(alice.token, actionId);
    expect(second.statusCode).toBe(409);
    expect(await subtasksOf(parent)).toHaveLength(2);
  });

  it('a failing insert rolls the whole materialization back — action stays pending, no subtasks', async () => {
    const alice = await registerUser(app, 'alice');
    const parent = await createTask(alice.token, '写季度总结');
    // estimateMinutes 1e10 overflows the integer column on the second insert.
    const actionId = await seedAction({
      userId: alice.id,
      targetId: parent,
      payload: {
        subtasks: [
          { title: '第一步', estimateMinutes: 15 },
          { title: '第二步', estimateMinutes: 10_000_000_000 },
        ],
      },
    });

    const res = await accept(alice.token, actionId);
    expect(res.statusCode).toBe(500);
    const [row] = await getDb().select().from(agentActions).where(eq(agentActions.id, actionId));
    expect(row!.feedback).toBe('pending');
    expect(row!.feedbackPayload).toBeNull();
    expect(await subtasksOf(parent)).toHaveLength(0);
  });

  it('accepting a decompose whose parent task is gone returns 409 and stays pending', async () => {
    const alice = await registerUser(app, 'alice');
    const parent = await createTask(alice.token, '将删的任务');
    const actionId = await seedAction({ userId: alice.id, targetId: parent });
    const del = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/tasks/${parent}`,
      token: alice.token,
    });
    expect(del.statusCode).toBe(204);

    const res = await accept(alice.token, actionId);
    expect(res.statusCode).toBe(409);
    const [row] = await getDb().select().from(agentActions).where(eq(agentActions.id, actionId));
    expect(row!.feedback).toBe('pending');
  });

  it('dismiss on task.decompose creates nothing (regression)', async () => {
    const alice = await registerUser(app, 'alice');
    const parent = await createTask(alice.token, '写季度总结');
    const actionId = await seedAction({ userId: alice.id, targetId: parent });

    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${actionId}/feedback`,
      token: alice.token,
      payload: { feedback: 'dismissed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().feedback).toBe('dismissed');
    expect(await subtasksOf(parent)).toHaveLength(0);
  });

  it('accepted + task.draft still appends notes and creates no subtasks (regression)', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '可委派任务');
    const actionId = await seedAction({
      userId: alice.id,
      targetId: taskId,
      actionType: 'task.draft',
      payload: { draft: '第一步：列大纲\n第二步：填数据' },
    });

    const res = await accept(alice.token, actionId);
    expect(res.statusCode).toBe(200);
    expect(res.json().feedback).toBe('accepted');
    const [row] = await getDb().select().from(tasks).where(eq(tasks.id, taskId));
    expect(row!.notesMd).toContain('第一步：列大纲');
    expect(await subtasksOf(taskId)).toHaveLength(0);
  });

  it('materialized subtasks are appended after existing subtasks, payload order preserved', async () => {
    const alice = await registerUser(app, 'alice');
    const parent = await createTask(alice.token, '写季度总结');
    const existing = await createTask(alice.token, '已有的子任务', { parentId: parent });
    const [existingRow] = await getDb().select().from(tasks).where(eq(tasks.id, existing));

    const actionId = await seedAction({ userId: alice.id, targetId: parent });
    const res = await accept(alice.token, actionId);
    expect(res.statusCode).toBe(200);

    const children = await subtasksOf(parent);
    expect(children).toHaveLength(3);
    expect(children[0]?.id).toBe(existing);
    // New ones come after the existing child, in payload order.
    expect(children[1]?.title).toBe('列大纲');
    expect(children[2]?.title).toBe('填数据');
    expect(children[1]!.sortOrder).toBeGreaterThan(existingRow!.sortOrder);
    expect(children[2]!.sortOrder).toBeGreaterThan(children[1]!.sortOrder);
  });
});

describe('POST /api/v1/agent/actions/:id/undo', () => {
  it('soft-deletes every materialized subtask and marks the action undone', async () => {
    const alice = await registerUser(app, 'alice');
    const parent = await createTask(alice.token, '写季度总结');
    const actionId = await seedAction({ userId: alice.id, targetId: parent });
    const accepted = await accept(alice.token, actionId);
    expect(accepted.statusCode).toBe(200);
    const taskIds = accepted.json().feedbackPayload.materialized.taskIds as string[];

    const res = await undo(alice.token, actionId);
    expect(res.statusCode).toBe(200);
    expect(res.json().feedback).toBe('undone');
    expect(res.json().feedbackPayload).toEqual({ materialized: { taskIds } });

    for (const id of taskIds) {
      const [row] = await getDb().select().from(tasks).where(eq(tasks.id, id));
      expect(row!.deletedAt).not.toBeNull();
    }
    // The parent survives.
    const [parentRow] = await getDb().select().from(tasks).where(eq(tasks.id, parent));
    expect(parentRow!.deletedAt).toBeNull();

    const [row] = await getDb().select().from(agentActions).where(eq(agentActions.id, actionId));
    expect(row!.feedback).toBe('undone');
    expect(row!.feedbackAt).not.toBeNull();
    expect(row!.feedbackPayload).toEqual({ materialized: { taskIds } });
  });

  it('409 when a materialized subtask was completed', async () => {
    const alice = await registerUser(app, 'alice');
    const parent = await createTask(alice.token, '写季度总结');
    const actionId = await seedAction({ userId: alice.id, targetId: parent });
    const accepted = await accept(alice.token, actionId);
    const taskIds = accepted.json().feedbackPayload.materialized.taskIds as string[];

    await getDb().update(tasks).set({ status: 'done' }).where(eq(tasks.id, taskIds[0]!));

    const res = await undo(alice.token, actionId);
    expect(res.statusCode).toBe(409);
    // Nothing was deleted.
    for (const id of taskIds) {
      const [row] = await getDb().select().from(tasks).where(eq(tasks.id, id));
      expect(row!.deletedAt).toBeNull();
    }
    const [row] = await getDb().select().from(agentActions).where(eq(agentActions.id, actionId));
    expect(row!.feedback).toBe('accepted');
  });

  it('409 when a materialized subtask is already soft-deleted', async () => {
    const alice = await registerUser(app, 'alice');
    const parent = await createTask(alice.token, '写季度总结');
    const actionId = await seedAction({ userId: alice.id, targetId: parent });
    const accepted = await accept(alice.token, actionId);
    const taskIds = accepted.json().feedbackPayload.materialized.taskIds as string[];

    await getDb()
      .update(tasks)
      .set({ deletedAt: new Date() })
      .where(eq(tasks.id, taskIds[0]!));

    const res = await undo(alice.token, actionId);
    expect(res.statusCode).toBe(409);
    const [row] = await getDb().select().from(agentActions).where(eq(agentActions.id, actionId));
    expect(row!.feedback).toBe('accepted');
  });

  it('409 for a pending action, 409 for accepted without materialization, 404 for a missing id', async () => {
    const alice = await registerUser(app, 'alice');
    const parent = await createTask(alice.token, '写季度总结');

    const pendingId = await seedAction({ userId: alice.id, targetId: parent });
    expect((await undo(alice.token, pendingId)).statusCode).toBe(409);

    // Accepted task.draft has no materialized entities.
    const draftId = await seedAction({
      userId: alice.id,
      targetId: parent,
      actionType: 'task.draft',
      feedback: 'accepted',
      payload: { draft: '草稿' },
    });
    expect((await undo(alice.token, draftId)).statusCode).toBe(409);

    expect((await undo(alice.token, randomUUID())).statusCode).toBe(404);
  });

  it('never undoes another user’s action', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const parent = await createTask(alice.token, '写季度总结');
    const actionId = await seedAction({ userId: alice.id, targetId: parent });
    const accepted = await accept(alice.token, actionId);
    expect(accepted.statusCode).toBe(200);

    expect((await undo(bob.token, actionId)).statusCode).toBe(404);
  });
});
