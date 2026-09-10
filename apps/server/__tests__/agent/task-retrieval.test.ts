/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
/* eslint-disable @typescript-eslint/unbound-method -- vi.mocked on fake client methods */
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueAgentJob,
  enqueueTaskDecompose,
  enqueueTaskDraft,
  processDueAgentJobs,
} from '../../src/agent/jobs.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, outcomes, tasks } from '../../src/db/schema.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type EmbeddingClient,
  type MeiliClient,
  type QdrantClient,
  type RerankClient,
} from '../../src/retrieval/registry.js';
import { waitForTaskIndexIdle } from '../../src/retrieval/tasks.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { inboxId, registerUser } from '../helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterEach(async () => {
  setPiResolveOverride(null);
  resetRetrievalClientsForTest();
  await waitForTaskIndexIdle();
});

afterAll(async () => {
  await app.close();
});

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

function fakeEmbedding(): EmbeddingClient {
  return { embedTexts: vi.fn<EmbeddingClient['embedTexts']>().mockResolvedValue([[1, 0, 0]]) };
}

function fakeQdrant(overrides: Partial<QdrantClient> = {}): QdrantClient {
  return {
    ensureCollection: vi.fn(),
    upsertPoints: vi.fn<QdrantClient['upsertPoints']>().mockResolvedValue(undefined),
    queryPoints: vi.fn<QdrantClient['queryPoints']>().mockResolvedValue([]),
    deletePoints: vi.fn<QdrantClient['deletePoints']>().mockResolvedValue(undefined),
    scrollPoints: vi.fn<QdrantClient['scrollPoints']>().mockResolvedValue([]),
    ...overrides,
  };
}

function fakeMeili(overrides: Partial<MeiliClient> = {}): MeiliClient {
  return {
    ensureIndex: vi.fn(),
    upsertDocuments: vi.fn<MeiliClient['upsertDocuments']>().mockResolvedValue(undefined),
    deleteDocuments: vi.fn<MeiliClient['deleteDocuments']>().mockResolvedValue(undefined),
    search: vi.fn<MeiliClient['search']>().mockResolvedValue([]),
    multiSearch: vi.fn(),
    listDocuments: vi.fn<MeiliClient['listDocuments']>().mockResolvedValue({ results: [], total: 0 }),
    ...overrides,
  };
}

function fakeRerank(): RerankClient {
  return {
    rerankTexts: vi.fn<RerankClient['rerankTexts']>().mockResolvedValue([{ index: 0, score: 0.9 }]),
  };
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

function contextText(ctx: Context): string {
  return ctx.messages
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
}

describe('task index hooks', () => {
  it('indexes on create, re-indexes on patch/complete, removes on delete', async () => {
    const embedding = fakeEmbedding();
    const qdrant = fakeQdrant();
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding, qdrant, meili, rerank: null });
    const alice = await registerUser(app, 'alice');

    const taskId = await createTask(alice.token, '写季度总结', { notes: '给部门汇报用' });
    await waitForTaskIndexIdle();

    let upserts = vi.mocked(qdrant.upsertPoints).mock.calls;
    expect(upserts).toHaveLength(1);
    expect(upserts[0]![0]).toBe('tasks');
    expect(upserts[0]![1][0]).toMatchObject({
      id: taskId,
      payload: {
        userId: alice.id,
        status: 'todo',
        title: '写季度总结',
        content: '写季度总结\n给部门汇报用',
      },
    });
    const docs = vi.mocked(meili.upsertDocuments).mock.calls;
    expect(docs).toHaveLength(1);
    expect(docs[0]![1][0]).toMatchObject({
      id: taskId,
      userId: alice.id,
      type: 'task',
      title: '写季度总结',
      status: 'todo',
    });

    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
      payload: { title: '写年度总结' },
    });
    expect(patched.statusCode).toBe(200);
    await waitForTaskIndexIdle();
    upserts = vi.mocked(qdrant.upsertPoints).mock.calls;
    expect(upserts).toHaveLength(2);
    expect(upserts[1]![1][0]).toMatchObject({ id: taskId, payload: { title: '写年度总结' } });

    const completed = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/complete`,
      token: alice.token,
    });
    expect(completed.statusCode).toBe(200);
    await waitForTaskIndexIdle();
    upserts = vi.mocked(qdrant.upsertPoints).mock.calls;
    expect(upserts).toHaveLength(3);
    expect(upserts[2]![1][0]).toMatchObject({ id: taskId, payload: { status: 'done' } });

    const deleted = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
    });
    expect(deleted.statusCode).toBe(204);
    await waitForTaskIndexIdle();
    expect(vi.mocked(qdrant.deletePoints).mock.calls).toEqual([[['tasks'][0], [taskId]]]);
    expect(meili.deleteDocuments).toHaveBeenCalledWith('tasks', [taskId]);
  });

  it('removes children from the index when a parent task is deleted', async () => {
    const qdrant = fakeQdrant();
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding: fakeEmbedding(), qdrant, meili, rerank: null });
    const alice = await registerUser(app, 'alice');

    const parentId = await createTask(alice.token, '父任务');
    const inbox = await inboxId(app, alice.token);
    const childRes = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '子任务', listId: inbox, parentId },
    });
    expect(childRes.statusCode).toBe(201);
    const childId = childRes.json().id as string;
    await waitForTaskIndexIdle();

    await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/tasks/${parentId}`,
      token: alice.token,
    });
    await waitForTaskIndexIdle();
    const deletedIds = vi
      .mocked(qdrant.deletePoints)
      .mock.calls.flatMap(([, ids]) => ids.map(String));
    expect(deletedIds).toContain(parentId);
    expect(deletedIds).toContain(childId);
  });

  it('index failures never break the task API', async () => {
    const qdrant = fakeQdrant({
      upsertPoints: vi.fn<QdrantClient['upsertPoints']>().mockRejectedValue(new Error('down')),
    });
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant,
      meili: fakeMeili(),
      rerank: null,
    });
    const alice = await registerUser(app, 'alice');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const taskId = await createTask(alice.token, '索引会失败的任务');
    await waitForTaskIndexIdle();
    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls.some(([msg]) => String(msg).includes('[retrieval]'))).toBe(true);
    consoleSpy.mockRestore();

    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks/${taskId}`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('索引会失败的任务');
  });
});

describe('outcome.cluster vector pre-grouping', () => {
  async function seedUnassigned(token: string, titles: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const title of titles) ids.push(await createTask(token, title));
    return ids;
  }

  async function runCluster(userId: string): Promise<void> {
    await enqueueAgentJob(getDb(), {
      userId,
      jobType: 'outcome.cluster',
      dedupKey: `cluster:${userId}`,
      payload: { date: 'today' },
      scheduledAt: new Date(),
    });
    expect(await processDueAgentJobs(new Date())).toBe(1);
  }

  it('injects vector pre-groups into the cluster prompt', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant: fakeQdrant(),
      meili: null,
      rerank: null,
    });
    const ids = await seedUnassigned(alice.token, [
      '买跑步鞋',
      '买运动袜',
      '写季度总结',
      '写年度总结',
    ]);
    await waitForTaskIndexIdle();

    const qdrant = fakeQdrant({
      scrollPoints: vi.fn<QdrantClient['scrollPoints']>().mockResolvedValue([
        { id: ids[0]!, payload: {}, vector: [1, 0] },
        { id: ids[1]!, payload: {}, vector: [0.999, 0.04] },
        { id: ids[2]!, payload: {}, vector: [0, 1] },
        { id: ids[3]!, payload: {}, vector: [0.04, 0.999] },
      ]),
    });
    setRetrievalClientsForTest({ embedding: fakeEmbedding(), qdrant, meili: null, rerank: null });

    let seen: Context | null = null;
    faux.setResponses([
      (context) => {
        seen = context;
        return fauxAssistantMessage(
          fauxToolCall('propose_threads', {
            threads: [
              { name: '运动装备', headline: '', taskIds: [ids[0]!, ids[1]!] },
              { name: '写作', headline: '', taskIds: [ids[2]!, ids[3]!] },
            ],
          }),
        );
      },
    ]);
    await runCluster(alice.id);

    expect(seen).not.toBeNull();
    const text = contextText(seen as unknown as Context);
    expect(text).toContain('可作为分组参考');
    const hintLines = text.split('\n').filter((line) => line.includes('组'));
    expect(
      hintLines.some((line) => line.includes('买跑步鞋') && line.includes('买运动袜')),
    ).toBe(true);
    expect(
      hintLines.some((line) => line.includes('写季度总结') && line.includes('写年度总结')),
    ).toBe(true);
  });

  it('skips the hint when qdrant is unavailable or scroll fails', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    setRetrievalClientsForTest({ embedding: null, qdrant: null, meili: null, rerank: null });
    const ids = await seedUnassigned(alice.token, ['任务一', '任务二', '任务三', '任务四']);

    const seen: string[] = [];
    faux.setResponses([
      (context) => {
        seen.push(contextText(context));
        return fauxAssistantMessage(
          fauxToolCall('propose_threads', {
            threads: [{ name: '杂事', headline: '', taskIds: [ids[0]!, ids[1]!] }],
          }),
        );
      },
      (context) => {
        seen.push(contextText(context));
        return fauxAssistantMessage(
          fauxToolCall('propose_threads', {
            threads: [{ name: '杂事二', headline: '', taskIds: [ids[2]!, ids[3]!] }],
          }),
        );
      },
    ]);

    // qdrant null → no hint.
    await runCluster(alice.id);
    expect(seen[0]).not.toContain('可作为分组参考');

    // scroll throws → no hint, main flow unaffected.
    const qdrant = fakeQdrant({
      scrollPoints: vi
        .fn<QdrantClient['scrollPoints']>()
        .mockRejectedValue(new Error('qdrant down')),
    });
    setRetrievalClientsForTest({ embedding: null, qdrant, meili: null, rerank: null });
    // First run attached ids[0..1]; top up so the pile clears the cluster minimum.
    await seedUnassigned(alice.token, ['任务五', '任务六']);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await runCluster(alice.id);
    consoleSpy.mockRestore();
    expect(seen[1]).not.toContain('可作为分组参考');

    const created = await getDb().select().from(outcomes).where(eq(outcomes.userId, alice.id));
    expect(created).toHaveLength(2);
  });
});

describe('decompose / draft similar-task examples', () => {
  async function seedDoneTaskWithSubtasks(
    token: string,
    title: string,
    subtasks: string[],
  ): Promise<string> {
    const parentId = await createTask(token, title);
    const inbox = await inboxId(app, token);
    for (const sub of subtasks) {
      const res = await injectJson(app, {
        method: 'POST',
        url: '/api/v1/tasks',
        token,
        payload: { title: sub, listId: inbox, parentId },
      });
      expect(res.statusCode).toBe(201);
    }
    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${parentId}/complete`,
      token,
    });
    expect(done.statusCode).toBe(200);
    return parentId;
  }

  async function markDelegable(token: string, taskId: string): Promise<void> {
    const res = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/tasks/${taskId}`,
      token,
      payload: { delegable: true },
    });
    expect(res.statusCode).toBe(200);
  }

  function similarClients(doneTaskId: string, doneTitle: string) {
    return {
      embedding: fakeEmbedding(),
      qdrant: fakeQdrant({
        queryPoints: vi.fn<QdrantClient['queryPoints']>().mockResolvedValue([
          { id: doneTaskId, score: 0.9, payload: { title: doneTitle, content: doneTitle } },
        ]),
      }),
      meili: fakeMeili(),
      rerank: fakeRerank(),
    };
  }

  it('decompose prompt carries similar done tasks with their subtask structure', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant: fakeQdrant(),
      meili: fakeMeili(),
      rerank: null,
    });
    const doneId = await seedDoneTaskWithSubtasks(alice.token, '写年度总结', ['列大纲', '填数据']);
    const targetId = await createTask(alice.token, '写季度总结');
    await getDb().update(tasks).set({ deferCount: 3 }).where(eq(tasks.id, targetId));
    await waitForTaskIndexIdle();
    setRetrievalClientsForTest(similarClients(doneId, '写年度总结'));

    let seen: Context | null = null;
    faux.setResponses([
      (context) => {
        seen = context;
        return fauxAssistantMessage(
          fauxToolCall('propose_subtasks', { subtasks: [{ title: '先列提纲' }] }),
        );
      },
    ]);
    await enqueueTaskDecompose(getDb(), alice.id, targetId, new Date());
    await processDueAgentJobs(new Date(Date.now() + 60_000));

    expect(seen).not.toBeNull();
    const text = contextText(seen as unknown as Context);
    expect(text).toContain('写年度总结');
    expect(text).toContain('列大纲');
    expect(text).toContain('填数据');

    const actions = await getDb()
      .select()
      .from(agentActions)
      .where(eq(agentActions.targetId, targetId));
    expect(actions).toHaveLength(1);
    expect(actions[0]!.actionType).toBe('task.decompose');
  });

  it('draft prompt carries similar done tasks', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant: fakeQdrant(),
      meili: fakeMeili(),
      rerank: null,
    });
    const doneId = await seedDoneTaskWithSubtasks(alice.token, '筹备年会', ['订场地', '发邀请']);
    const targetId = await createTask(alice.token, '筹备季度团建');
    await markDelegable(alice.token, targetId);
    await waitForTaskIndexIdle();
    setRetrievalClientsForTest(similarClients(doneId, '筹备年会'));

    let seen: Context | null = null;
    faux.setResponses([
      (context) => {
        seen = context;
        return fauxAssistantMessage(fauxToolCall('submit_draft', { draft: '先订场地。' }));
      },
    ]);
    await enqueueTaskDraft(getDb(), alice.id, targetId, new Date());
    await processDueAgentJobs(new Date());

    expect(seen).not.toBeNull();
    const text = contextText(seen as unknown as Context);
    expect(text).toContain('筹备年会');
    expect(text).toContain('订场地');
  });

  it('search failures never break decompose or draft', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant: fakeQdrant({
        queryPoints: vi
          .fn<QdrantClient['queryPoints']>()
          .mockRejectedValue(new Error('qdrant down')),
      }),
      meili: fakeMeili(),
      rerank: null,
    });
    const decomposeId = await createTask(alice.token, '拖延的任务');
    await getDb().update(tasks).set({ deferCount: 3 }).where(eq(tasks.id, decomposeId));
    const draftId = await createTask(alice.token, '可委派任务');
    await markDelegable(alice.token, draftId);
    await waitForTaskIndexIdle();

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('propose_subtasks', { subtasks: [{ title: '第一步' }] }),
      ),
      fauxAssistantMessage(fauxToolCall('submit_draft', { draft: '方案。' })),
    ]);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await enqueueTaskDecompose(getDb(), alice.id, decomposeId, new Date());
    await processDueAgentJobs(new Date(Date.now() + 60_000));
    await enqueueTaskDraft(getDb(), alice.id, draftId, new Date());
    await processDueAgentJobs(new Date(Date.now() + 60_000));
    consoleSpy.mockRestore();

    expect(faux.state.callCount).toBe(2);
    const actions = await getDb()
      .select()
      .from(agentActions)
      .where(eq(agentActions.userId, alice.id));
    expect(actions.map((a) => a.actionType).sort()).toEqual(['task.decompose', 'task.draft']);
  });
});
