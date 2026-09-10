/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueTaskDraft, processDueAgentJobs } from '../../src/agent/jobs.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, agentJobs, agentUsage, tasks } from '../../src/db/schema.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { inboxId, registerUser } from '../helpers/session.js';

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

async function setupFauxUser(name: string): Promise<{ id: string; token: string }> {
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

async function taskRow(taskId: string) {
  const [row] = await getDb().select().from(tasks).where(eq(tasks.id, taskId));
  return row!;
}

async function draftActions(taskId: string) {
  return getDb()
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.targetId, taskId), eq(agentActions.actionType, 'task.draft')));
}

describe('task delegable flag', () => {
  it('defaults to false and is patchable', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '写季度总结');

    const initial = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().delegable).toBe(false);

    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().delegable).toBe(true);
    expect((await taskRow(taskId)).delegable).toBe(true);

    const off = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().delegable).toBe(false);
  });

  it('rejects enabling delegable on a completed task', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '已完成的任务');
    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/complete`,
      token: alice.token,
    });
    expect(done.statusCode).toBe(200);

    const res = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: true },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v1/tasks/:id/draft', () => {
  it('rejects tasks that are not delegable, completed, or not owned', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const plain = await createTask(alice.token, '普通任务');
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${plain}/draft`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(400);

    const foreign = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${plain}/draft`,
      token: bob.token,
    });
    expect(foreign.statusCode).toBe(404);

    const delegable = await createTask(alice.token, '可委派任务');
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${delegable}`,
      token: alice.token,
      payload: { delegable: true },
    });
    const completed = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${delegable}/complete`,
      token: alice.token,
    });
    expect(completed.statusCode).toBe(200);
    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${delegable}/draft`,
      token: alice.token,
    });
    expect(done.statusCode).toBe(400);
  });

  it('queues a task.draft job; a retrigger while queued stays a single job', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '准备发布会材料');
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: true },
    });

    const first = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/draft`,
      token: alice.token,
    });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ status: 'queued', action: null });

    const again = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/draft`,
      token: alice.token,
    });
    expect(again.statusCode).toBe(202);

    const jobs = await getDb()
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.dedupKey, `task.draft:${taskId}`));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.jobType).toBe('task.draft');
    expect(jobs[0]!.payload).toEqual({ taskId });
  });
});

describe('task.draft processor', () => {
  it('drafts a plan via the LLM and writes a pending agent action + usage', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_draft', { draft: '1. 列大纲\n2. 收集数据\n3. 约评审' }),
      ),
    ]);
    const taskId = await createTask(alice.token, '写季度总结', { notes: '给部门汇报用' });
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: true },
    });

    await enqueueTaskDraft(getDb(), alice.id, taskId, new Date());
    const n = await processDueAgentJobs(new Date());
    expect(n).toBe(1);
    expect(faux.state.callCount).toBe(1);

    const actions = await draftActions(taskId);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.targetType).toBe('task');
    expect(actions[0]!.feedback).toBe('pending');
    expect(actions[0]!.payload['draft']).toBe('1. 列大纲\n2. 收集数据\n3. 约评审');
    expect(actions[0]!.jobId).not.toBeNull();

    const usage = await getDb().select().from(agentUsage).where(eq(agentUsage.userId, alice.id));
    expect(usage).toHaveLength(1);
    expect(usage[0]!.capability).toBe('draft');
  });

  it('is idempotent: a pending draft suppresses a second LLM run', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('submit_draft', { draft: '第一步先调研。' })),
    ]);
    const taskId = await createTask(alice.token, '评估新供应商');
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: true },
    });

    await enqueueTaskDraft(getDb(), alice.id, taskId, new Date());
    await processDueAgentJobs(new Date());
    expect(faux.state.callCount).toBe(1);
    expect(await draftActions(taskId)).toHaveLength(1);

    // Re-arm and process again — the pending draft blocks a second proposal.
    await enqueueTaskDraft(getDb(), alice.id, taskId, new Date());
    await processDueAgentJobs(new Date());
    expect(faux.state.callCount).toBe(1);
    expect(await draftActions(taskId)).toHaveLength(1);

    // The trigger endpoint also returns the existing pending draft.
    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/draft`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending');
    expect(res.json().action.actionType).toBe('task.draft');
    expect(res.json().action.payload.draft).toBe('第一步先调研。');
  });

  it('skips tasks that lost delegable or got completed before the job ran', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall('submit_draft', { draft: '不应产生。' })),
    ]);
    const taskId = await createTask(alice.token, '临时任务');
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: true },
    });
    await enqueueTaskDraft(getDb(), alice.id, taskId, new Date());

    // User turned the flag back off before the worker picked the job up.
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: false },
    });
    await processDueAgentJobs(new Date());
    expect(faux.state.callCount).toBe(0);
    expect(await draftActions(taskId)).toHaveLength(0);

    // Completed task: also a no-op.
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: true },
    });
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/complete`,
      token: alice.token,
    });
    await enqueueTaskDraft(getDb(), alice.id, taskId, new Date());
    await processDueAgentJobs(new Date());
    expect(faux.state.callCount).toBe(0);
    expect(await draftActions(taskId)).toHaveLength(0);
  });

  it('degrades cleanly when no LLM is routed', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '无模型任务');
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { delegable: true },
    });
    await enqueueTaskDraft(getDb(), alice.id, taskId, new Date());
    await processDueAgentJobs(new Date());
    expect(await draftActions(taskId)).toHaveLength(0);
    const jobs = await getDb()
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.dedupKey, `task.draft:${taskId}`));
    expect(jobs[0]!.status).toBe('done');
    expect(jobs[0]!.lastError).toBe('skipped:no-llm');
  });
});

describe('task.draft feedback', () => {
  async function seedDraft(userId: string, taskId: string, draft: string): Promise<string> {
    const id = randomUUID();
    await getDb()
      .insert(agentActions)
      .values({
        id,
        userId,
        actionType: 'task.draft',
        targetType: 'task',
        targetId: taskId,
        payload: { draft },
        feedback: 'pending',
      });
    return id;
  }

  it('accepted appends the draft to the task notes', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '写季度总结', { notes: '原有备注' });
    const actionId = await seedDraft(alice.id, taskId, '1. 列大纲\n2. 填数据');

    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${actionId}/feedback`,
      token: alice.token,
      payload: { feedback: 'accepted' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().feedback).toBe('accepted');

    const row = await taskRow(taskId);
    expect(row.notesMd).toBe('原有备注\n\n1. 列大纲\n2. 填数据');

    // Empty notes: the draft becomes the whole notes body.
    const bare = await createTask(alice.token, '空备注任务');
    const bareAction = await seedDraft(alice.id, bare, '先列提纲。');
    const res2 = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${bareAction}/feedback`,
      token: alice.token,
      payload: { feedback: 'accepted' },
    });
    expect(res2.statusCode).toBe(200);
    expect((await taskRow(bare)).notesMd).toBe('先列提纲。');
  });

  it('dismissed leaves the notes untouched', async () => {
    const alice = await registerUser(app, 'alice');
    const taskId = await createTask(alice.token, '写季度总结', { notes: '原有备注' });
    const actionId = await seedDraft(alice.id, taskId, '1. 列大纲');

    const res = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/agent/actions/${actionId}/feedback`,
      token: alice.token,
      payload: { feedback: 'dismissed' },
    });
    expect(res.statusCode).toBe(200);
    expect((await taskRow(taskId)).notesMd).toBe('原有备注');
  });
});
