/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueOutcomeRefresh, processDueAgentJobs } from '../../src/agent/jobs.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, agentEditEvents, outcomes } from '../../src/db/schema.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { inboxId, registerUser } from '../helpers/session.js';

/** Route every resolution to a scriptable faux provider (mirror of harness.test.ts). */
function installFaux() {
  const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1' }] });
  setPiResolveOverride((stored, route, apiKey) => {
    const models = createModels();
    models.setProvider(faux.provider);
    const model = models.getModel('faux', route.model);
    if (!model) return null;
    return { models, model, apiKey, route, stored };
  });
  return faux;
}

async function setupFauxUser(name: string) {
  const user = await registerUser(app, name);
  const added = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/llm/providers',
    token: user.token,
    payload: {
      providerId: 'custom',
      label: '测试网关',
      baseUrl: 'http://faux.test/v1',
      apiKey: 'sk-secret',
      models: ['faux-1'],
    },
  });
  expect(added.statusCode).toBe(200);
  const providerId = added.json().providers[0].id as string;
  const routed = await injectJson(app, {
    method: 'PUT',
    url: '/api/v1/llm/routing',
    token: user.token,
    payload: { routing: { default: { providerId, model: 'faux-1' } } },
  });
  expect(routed.statusCode).toBe(200);
  return user;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterEach(() => {
  setPiResolveOverride(null);
});

afterAll(async () => {
  await app.close();
});

async function createTask(token: string, title: string, extra: Record<string, unknown> = {}): Promise<string> {
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

async function patchTask(token: string, id: string, patch: Record<string, unknown>) {
  const res = await injectJson(app, {
    method: 'PATCH',
    url: `/api/v1/tasks/${id}`,
    token,
    payload: patch,
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

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

async function eventsOf(userId: string) {
  return getDb().select().from(agentEditEvents).where(eq(agentEditEvents.userId, userId));
}

function fieldsByField(row: { fields: { field: string; before: unknown; after: unknown }[] }) {
  return new Map(row.fields.map((f) => [f.field, f]));
}

describe('agent_edit_events collection (task patches)', () => {
  it('records one event per patch with every tracked field change', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token, '换工作');
    const taskId = await createTask(alice.token, '写季度总结');

    const after = await patchTask(alice.token, taskId, {
      title: '写周报',
      dueAt: '2026-09-20T10:00:00+08:00',
      priority: 1,
      estimateMinutes: 45,
      outcomeId,
    });

    const rows = await eventsOf(alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityType).toBe('task');
    expect(rows[0]!.entityId).toBe(taskId);
    expect(rows[0]!.source).toBe('user');

    const byField = fieldsByField(rows[0]!);
    expect(byField.get('title')).toEqual({ field: 'title', before: '写季度总结', after: '写周报' });
    expect(byField.get('priority')).toEqual({ field: 'priority', before: 3, after: 1 });
    expect(byField.get('estimateMinutes')).toEqual({ field: 'estimateMinutes', before: null, after: 45 });
    expect(byField.get('outcomeId')).toEqual({ field: 'outcomeId', before: null, after: outcomeId });
    // Instants are stored as ISO summary values matching the API's rendering.
    expect(byField.get('dueAt')!.before).toBeNull();
    expect(new Date(byField.get('dueAt')!.after as string).toISOString()).toBe(after.dueAt);
  });

  it('truncates long titles to ~120 chars in before/after', async () => {
    const alice = await registerUser(app, 'alice');
    const longA = 'A'.repeat(150);
    const longB = 'B'.repeat(150);
    const taskId = await createTask(alice.token, longA);
    await patchTask(alice.token, taskId, { title: longB });

    const rows = await eventsOf(alice.id);
    expect(rows).toHaveLength(1);
    const title = fieldsByField(rows[0]!).get('title')!;
    expect((title.before as string).length).toBe(120);
    expect((title.after as string).length).toBe(120);
  });

  it('skips patches with no tracked change (notes only, or same values)', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '保持不变');

    await patchTask(alice.token, taskId, { notes: '只改备注，不是学习信号' });
    await patchTask(alice.token, taskId, { title: '保持不变' });
    await patchTask(alice.token, taskId, { estimateMinutes: null });

    expect(await eventsOf(alice.id)).toHaveLength(0);
  });

  it('records a thread rename as an outcome edit event', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token, '换工作');
    const res = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/outcomes/${outcomeId}`,
      token: alice.token,
      payload: { name: '换到 AI 公司' },
    });
    expect(res.statusCode).toBe(200);

    const rows = await eventsOf(alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityType).toBe('outcome');
    expect(rows[0]!.entityId).toBe(outcomeId);
    expect(rows[0]!.fields).toEqual([{ field: 'name', before: '换工作', after: '换到 AI 公司' }]);
  });
});

describe('agent write paths never produce edit events', () => {
  async function seedAction(input: {
    userId: string;
    targetId: string;
    actionType: string;
    targetType?: string;
    payload?: Record<string, unknown>;
  }): Promise<string> {
    const id = randomUUID();
    await getDb().insert(agentActions).values({
      id,
      userId: input.userId,
      actionType: input.actionType,
      targetType: input.targetType ?? 'task',
      targetId: input.targetId,
      payload: input.payload ?? {},
    });
    return id;
  }

  it('task.draft acceptance appends notes without an edit event', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '可委派任务');
    const actionId = await seedAction({
      userId: alice.id,
      targetId: taskId,
      actionType: 'task.draft',
      payload: { draft: '第一步：列大纲' },
    });
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${actionId}/feedback`,
      token: alice.token,
      payload: { feedback: 'accepted' },
    });
    expect(res.statusCode).toBe(200);
    expect(await eventsOf(alice.id)).toHaveLength(0);
  });

  it('edited outcome.create rename bypasses the event stream', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token, 'Agent 起的线程');
    const actionId = await seedAction({
      userId: alice.id,
      targetId: outcomeId,
      actionType: 'outcome.create',
      targetType: 'outcome',
      payload: { name: 'Agent 起的线程', taskIds: [], headline: '' },
    });
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${actionId}/feedback`,
      token: alice.token,
      payload: { feedback: 'edited', editedPayload: { name: '用户改的名' } },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await getDb().select().from(outcomes).where(eq(outcomes.id, outcomeId));
    expect(row!.name).toBe('用户改的名');
    expect(await eventsOf(alice.id)).toHaveLength(0);
  });

  it('edited outcome.headline override bypasses the event stream', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token, '换工作');
    const actionId = await seedAction({
      userId: alice.id,
      targetId: outcomeId,
      actionType: 'outcome.headline',
      targetType: 'outcome',
      payload: { headline: '机器写的' },
    });
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${actionId}/feedback`,
      token: alice.token,
      payload: { feedback: 'edited', editedPayload: { headline: '用户改的状态' } },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await getDb().select().from(outcomes).where(eq(outcomes.id, outcomeId));
    expect(row!.agentHeadline).toBe('用户改的状态');
    expect(await eventsOf(alice.id)).toHaveLength(0);
  });

  it('decompose materialization creates subtasks without edit events', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '写季度总结');
    const actionId = await seedAction({
      userId: alice.id,
      targetId: taskId,
      actionType: 'task.decompose',
      payload: { subtasks: [{ title: '列大纲', estimateMinutes: 15 }] },
    });
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${actionId}/feedback`,
      token: alice.token,
      payload: { feedback: 'accepted' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().feedbackPayload.materialized.taskIds).toHaveLength(1);
    expect(await eventsOf(alice.id)).toHaveLength(0);
  });

  it('worker headline writes (outcome.refresh job) bypass the event stream', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_headline', { headline: '在推进 Q3 上线', suggestion: '先完成设计稿' }),
      ),
    ]);
    const outcomeId = await createOutcome(alice.token, '上线 Q3');
    await createTask(alice.token, '写设计稿');

    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });
    expect(await processDueAgentJobs(new Date())).toBe(1);

    const [row] = await getDb().select().from(outcomes).where(eq(outcomes.id, outcomeId));
    expect(row!.agentHeadline).toBe('在推进 Q3 上线');
    expect(await eventsOf(alice.id)).toHaveLength(0);
  });
});
