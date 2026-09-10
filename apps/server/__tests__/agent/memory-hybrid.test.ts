/* eslint-disable @typescript-eslint/unbound-method -- vi.mocked on fake client methods */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAgentMemory, MEMORY_INJECT_LIMIT } from '../../src/agent/harness.js';
import {
  enqueueOutcomeRefresh,
  enqueueTaskDecompose,
  processDueAgentJobs,
} from '../../src/agent/jobs.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentMemory, tasks, type AgentMemoryScope } from '../../src/db/schema.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type EmbeddingClient,
  type MeiliClient,
  type QdrantClient,
  type QdrantScoredPoint,
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

afterEach(() => {
  resetRetrievalClientsForTest();
});

afterAll(async () => {
  await app.close();
});

/** Direct insert bypasses the service layer on purpose: no index hooks fire. */
async function insertMemory(
  userId: string,
  content: string,
  opts: { manual?: boolean; createdAt?: Date; scope?: AgentMemoryScope[] } = {},
): Promise<string> {
  const id = randomUUID();
  await getDb().insert(agentMemory).values({
    id,
    userId,
    kind: 'preference',
    content,
    manual: opts.manual ?? false,
    scope: opts.scope ?? ['all'],
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  });
  return id;
}

function fakeEmbedding(): EmbeddingClient {
  return { embedTexts: vi.fn<EmbeddingClient['embedTexts']>().mockResolvedValue([[1, 0, 0]]) };
}

function fakeQdrant(points: QdrantScoredPoint[] = []): QdrantClient {
  return {
    ensureCollection: vi.fn(),
    upsertPoints: vi.fn<QdrantClient['upsertPoints']>().mockResolvedValue(undefined),
    queryPoints: vi.fn<QdrantClient['queryPoints']>().mockResolvedValue(points),
    deletePoints: vi.fn<QdrantClient['deletePoints']>().mockResolvedValue(undefined),
    scrollPoints: vi.fn<QdrantClient['scrollPoints']>().mockResolvedValue([]),
  };
}

function fakeMeili(): MeiliClient {
  return {
    ensureIndex: vi.fn(),
    upsertDocuments: vi.fn<MeiliClient['upsertDocuments']>().mockResolvedValue(undefined),
    deleteDocuments: vi.fn<MeiliClient['deleteDocuments']>().mockResolvedValue(undefined),
    listDocuments: vi
      .fn<MeiliClient['listDocuments']>()
      .mockResolvedValue({ results: [], total: 0 }),
    search: vi.fn<MeiliClient['search']>().mockResolvedValue([]),
    multiSearch: vi.fn(),
  };
}

/** Rerank that keeps the fused order: index 0..n-1, capped at topN. */
function identityRerank(): RerankClient {
  return {
    rerankTexts: vi
      .fn<RerankClient['rerankTexts']>()
      .mockImplementation((_query, documents, topN) =>
        Promise.resolve(documents.map((_, index) => ({ index, score: 1 })).slice(0, topN)),
      ),
  };
}

function scoredPoint(id: string, content: string, kind = 'preference'): QdrantScoredPoint {
  return { id, score: 0.9, payload: { kind, content } };
}

describe('loadAgentMemory hybrid retrieval', () => {
  it('with a query returns retrieval hits, manual memories prepended and deduped by id', async () => {
    const alice = await registerUser(app, 'alice');
    const t0 = Date.now();
    // Manual row the retrieval does not recall: must be prepended.
    await insertMemory(alice.id, '手写但未被检索到', {
      manual: true,
      createdAt: new Date(t0 - 2_000),
    });
    // Manual row the retrieval does recall: stays at its reranked slot, appears once.
    const recalledManualId = await insertMemory(alice.id, '手写且被检索到', {
      manual: true,
      createdAt: new Date(t0 - 1_000),
    });
    await insertMemory(alice.id, '检索命中');
    // Non-manual PG row the retrieval does not recall: hybrid path must not leak it.
    await insertMemory(alice.id, '蒸馏但未被检索到');

    const embedding = fakeEmbedding();
    const qdrant = fakeQdrant([
      scoredPoint(recalledManualId, '手写且被检索到'),
      scoredPoint(randomUUID(), '检索命中'),
    ]);
    setRetrievalClientsForTest({
      embedding,
      qdrant,
      meili: fakeMeili(),
      rerank: identityRerank(),
    });

    const memory = await loadAgentMemory(alice.id, 'draft', '季度总结');

    expect(embedding.embedTexts).toHaveBeenCalledWith(['季度总结'], expect.anything());
    expect(memory.map((m) => m.content)).toEqual([
      '手写但未被检索到',
      '手写且被检索到',
      '检索命中',
    ]);
  });

  it('manual memories whose scope lacks the capability are not injected (same as the PG path)', async () => {
    const alice = await registerUser(app, 'alice');
    const t0 = Date.now();
    // Out-of-scope manual row: must stay out even though it is manual.
    await insertMemory(alice.id, '手写但scope不含draft', {
      manual: true,
      scope: ['notify'],
      createdAt: new Date(t0 - 1_000),
    });
    // In-scope manual rows: 'draft' explicitly and 'all' both qualify.
    await insertMemory(alice.id, '手写且scope为draft', {
      manual: true,
      scope: ['draft'],
      createdAt: new Date(t0),
    });
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant: fakeQdrant(),
      meili: fakeMeili(),
      rerank: identityRerank(),
    });

    const memory = await loadAgentMemory(alice.id, 'draft', '季度总结');

    expect(memory.map((m) => m.content)).toEqual(['手写且scope为draft']);
  });

  it('falls back to PG recency when retrieval clients are missing', async () => {
    const alice = await registerUser(app, 'alice');
    const t0 = Date.now();
    await insertMemory(alice.id, '较早的记忆', { createdAt: new Date(t0 - 1_000) });
    await insertMemory(alice.id, '较新的记忆', { createdAt: new Date(t0) });
    setRetrievalClientsForTest({ embedding: null, qdrant: null, meili: null, rerank: null });

    const memory = await loadAgentMemory(alice.id, 'draft', '季度总结');

    expect(memory.map((m) => m.content)).toEqual(['较新的记忆', '较早的记忆']);
  });

  it('falls back to PG recency and logs when retrieval throws', async () => {
    const alice = await registerUser(app, 'alice');
    const t0 = Date.now();
    await insertMemory(alice.id, '较早的记忆', { createdAt: new Date(t0 - 1_000) });
    await insertMemory(alice.id, '较新的记忆', { createdAt: new Date(t0) });
    const embedding = fakeEmbedding();
    vi.mocked(embedding.embedTexts).mockRejectedValue(new Error('dashscope down'));
    setRetrievalClientsForTest({
      embedding,
      qdrant: fakeQdrant(),
      meili: fakeMeili(),
      rerank: identityRerank(),
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const memory = await loadAgentMemory(alice.id, 'draft', '季度总结');

    expect(memory.map((m) => m.content)).toEqual(['较新的记忆', '较早的记忆']);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[retrieval]'), expect.anything());
    errSpy.mockRestore();
  });

  it('without a query stays on the PG path and never calls embedding', async () => {
    const alice = await registerUser(app, 'alice');
    const t0 = Date.now();
    await insertMemory(alice.id, '较早的记忆', { createdAt: new Date(t0 - 1_000) });
    await insertMemory(alice.id, '较新的记忆', { createdAt: new Date(t0) });
    const embedding = fakeEmbedding();
    setRetrievalClientsForTest({
      embedding,
      qdrant: fakeQdrant(),
      meili: fakeMeili(),
      rerank: identityRerank(),
    });

    const memory = await loadAgentMemory(alice.id, 'draft');

    expect(memory.map((m) => m.content)).toEqual(['较新的记忆', '较早的记忆']);
    expect(embedding.embedTexts).not.toHaveBeenCalled();
  });

  it('manual rows survive beyond the inject limit while non-manual hits are truncated', async () => {
    const alice = await registerUser(app, 'alice');
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      await insertMemory(alice.id, `手写 ${String(i)}`, {
        manual: true,
        createdAt: new Date(t0 + i * 1_000),
      });
    }
    const points = Array.from({ length: MEMORY_INJECT_LIMIT + 5 }, (_, i) =>
      scoredPoint(randomUUID(), `命中 ${String(i)}`),
    );
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant: fakeQdrant(points),
      meili: fakeMeili(),
      rerank: identityRerank(),
    });

    const memory = await loadAgentMemory(alice.id, 'draft', '季度总结');

    // 3 manual (immune to the cap) + 20 retrieval hits (capped) = 23.
    expect(memory).toHaveLength(3 + MEMORY_INJECT_LIMIT);
    expect(memory.slice(0, 3).map((m) => m.content)).toEqual(['手写 2', '手写 1', '手写 0']);
    expect(memory.slice(3).map((m) => m.content)).toEqual(
      Array.from({ length: MEMORY_INJECT_LIMIT }, (_, i) => `命中 ${String(i)}`),
    );
  });
});

describe('processors pass a query into memory retrieval', () => {
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

  it('task.decompose retrieves memory with the task title as the query', async () => {
    const alice = await registerUser(app, 'alice');
    const embedding = fakeEmbedding();
    const qdrant = fakeQdrant();
    setRetrievalClientsForTest({
      embedding,
      qdrant,
      meili: fakeMeili(),
      rerank: identityRerank(),
    });
    const taskId = await createTask(alice.token, '写季度复盘');
    // Task index hooks fire on create; clear them so only the job's calls count.
    await waitForTaskIndexIdle();
    vi.mocked(embedding.embedTexts).mockClear();
    vi.mocked(qdrant.queryPoints).mockClear();
    await getDb().update(tasks).set({ deferCount: 3 }).where(eq(tasks.id, taskId));

    await enqueueTaskDecompose(getDb(), alice.id, taskId, new Date());
    await processDueAgentJobs(new Date(Date.now() + 60_000));

    expect(qdrant.queryPoints).toHaveBeenCalledWith(
      'agent_memory',
      expect.anything(),
      expect.objectContaining({
        must: expect.arrayContaining([
          expect.objectContaining({ key: 'userId', match: { value: alice.id } }),
        ]),
      }),
      expect.anything(),
    );
    expect(embedding.embedTexts).toHaveBeenCalledWith(
      [expect.stringContaining('写季度复盘')],
      expect.anything(),
    );
  });

  it('outcome.refresh retrieves memory with the outcome name as the query', async () => {
    const alice = await registerUser(app, 'alice');
    const embedding = fakeEmbedding();
    const qdrant = fakeQdrant();
    setRetrievalClientsForTest({
      embedding,
      qdrant,
      meili: fakeMeili(),
      rerank: identityRerank(),
    });
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/outcomes',
      token: alice.token,
      payload: { name: '上线 Q3' },
    });
    expect(res.statusCode).toBe(200);
    const outcomeId = res.json().id as string;

    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });
    await processDueAgentJobs(new Date());

    expect(qdrant.queryPoints).toHaveBeenCalledWith(
      'agent_memory',
      expect.anything(),
      expect.objectContaining({
        must: expect.arrayContaining([
          expect.objectContaining({ key: 'userId', match: { value: alice.id } }),
        ]),
      }),
      expect.anything(),
    );
    expect(embedding.embedTexts).toHaveBeenCalledWith(
      [expect.stringContaining('上线 Q3')],
      expect.anything(),
    );
  });
});
