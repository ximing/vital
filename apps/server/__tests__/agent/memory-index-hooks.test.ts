/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixture assertions */
import { randomUUID } from 'node:crypto';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueAgentJob, processDueAgentJobs } from '../../src/agent/jobs.js';
import {
  createAgentMemory,
  deleteAgentMemory,
  patchAgentMemory,
} from '../../src/agent/memory.service.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, agentJobs, agentMemory } from '../../src/db/schema.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import { waitForIndexIdle } from '../../src/retrieval/pipeline.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type EmbeddingClient,
  type MeiliClient,
  type QdrantClient,
  type RerankClient,
} from '../../src/retrieval/registry.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

let app: FastifyInstance;

function fakeEmbedding() {
  return {
    embedTexts: vi.fn<EmbeddingClient['embedTexts']>((texts) =>
      Promise.resolve(texts.map(() => [0.1, 0.2, 0.3])),
    ),
  };
}

function fakeQdrant() {
  return {
    ensureCollection: vi.fn<QdrantClient['ensureCollection']>(() => Promise.resolve()),
    upsertPoints: vi.fn<QdrantClient['upsertPoints']>(() => Promise.resolve()),
    queryPoints: vi.fn<QdrantClient['queryPoints']>(() => Promise.resolve([])),
    deletePoints: vi.fn<QdrantClient['deletePoints']>(() => Promise.resolve()),
    scrollPoints: vi.fn<QdrantClient['scrollPoints']>(() => Promise.resolve([])),
  };
}

function fakeMeili() {
  return {
    ensureIndex: vi.fn<MeiliClient['ensureIndex']>(() => Promise.resolve()),
    upsertDocuments: vi.fn<MeiliClient['upsertDocuments']>(() => Promise.resolve()),
    deleteDocuments: vi.fn<MeiliClient['deleteDocuments']>(() => Promise.resolve()),
    search: vi.fn<MeiliClient['search']>(() => Promise.resolve([])),
    multiSearch: vi.fn<MeiliClient['multiSearch']>(() => Promise.resolve({})),
    listDocuments: vi.fn<MeiliClient['listDocuments']>(() =>
      Promise.resolve({ results: [], total: 0 }),
    ),
  };
}

function fakeRerank() {
  return { rerankTexts: vi.fn<RerankClient['rerankTexts']>(() => Promise.resolve([])) };
}

let embedding: ReturnType<typeof fakeEmbedding>;
let qdrant: ReturnType<typeof fakeQdrant>;
let meili: ReturnType<typeof fakeMeili>;
let rerank: ReturnType<typeof fakeRerank>;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  embedding = fakeEmbedding();
  qdrant = fakeQdrant();
  meili = fakeMeili();
  rerank = fakeRerank();
  setRetrievalClientsForTest({ embedding, qdrant, meili, rerank });
});

afterEach(() => {
  resetRetrievalClientsForTest();
  setPiResolveOverride(null);
});

afterAll(async () => {
  await app.close();
});

/** Route every resolution to a scriptable faux provider (mirror of memory.test.ts). */
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

/** Direct insert bypasses the service layer on purpose: no index hooks fire. */
async function insertMemory(userId: string, content: string): Promise<string> {
  const id = randomUUID();
  await getDb().insert(agentMemory).values({
    id,
    userId,
    kind: 'preference',
    content,
    manual: false,
    scope: ['all'],
  });
  return id;
}

async function seedFeedback(userId: string, n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await getDb().insert(agentActions).values({
      id: randomUUID(),
      userId,
      jobId: null,
      actionType: 'outcome.headline',
      targetType: 'outcome',
      targetId: randomUUID(),
      payload: { headline: '提案' },
      feedback: i === 0 ? 'accepted' : i === 1 ? 'edited' : 'dismissed',
      feedbackAt: new Date(),
      createdAt: new Date(),
    });
  }
}

async function runDistill(userId: string): Promise<void> {
  await enqueueAgentJob(getDb(), {
    userId,
    jobType: 'memory.distill',
    payload: { date: '2026-W37' },
    dedupKey: `memory.distill:${userId}:2026-W37`,
    scheduledAt: new Date(Date.now() - 1_000),
  });
  const n = await processDueAgentJobs(new Date());
  expect(n).toBe(1);
  const [job] = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, userId));
  expect(job!.jobType).toBe('memory.distill');
  expect(job!.status).toBe('done');
  expect(job!.lastError).toBeNull();
}

describe('memory service index hooks', () => {
  it('indexes after create and patch, removes after delete', async () => {
    const alice = await registerUser(app, 'alice');

    const created = await createAgentMemory(alice.id, {
      kind: 'preference',
      content: '手写记忆',
      scope: ['all'],
    });
    await waitForIndexIdle();
    expect(qdrant.upsertPoints).toHaveBeenCalledWith('agent_memory', [
      expect.objectContaining({
        id: created.id,
        payload: expect.objectContaining({
          userId: alice.id,
          content: '手写记忆',
          kind: 'preference',
          manual: true,
          scope: ['all'],
        }),
      }),
    ]);
    expect(meili.upsertDocuments).toHaveBeenCalledWith('memories', [
      expect.objectContaining({ id: created.id, userId: alice.id, content: '手写记忆' }),
    ]);

    await patchAgentMemory(alice.id, created.id, { content: '改写后的记忆' });
    await waitForIndexIdle();
    expect(qdrant.upsertPoints).toHaveBeenLastCalledWith('agent_memory', [
      expect.objectContaining({
        id: created.id,
        payload: expect.objectContaining({ content: '改写后的记忆' }),
      }),
    ]);
    expect(meili.upsertDocuments).toHaveBeenLastCalledWith('memories', [
      expect.objectContaining({ id: created.id, content: '改写后的记忆' }),
    ]);

    await deleteAgentMemory(alice.id, created.id);
    await waitForIndexIdle();
    expect(qdrant.deletePoints).toHaveBeenCalledWith('agent_memory', [created.id]);
    expect(meili.deleteDocuments).toHaveBeenCalledWith('memories', [created.id]);
  });

  it('never lets an index failure break the business write', async () => {
    const alice = await registerUser(app, 'alice');
    embedding.embedTexts.mockRejectedValue(new Error('dashscope down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const created = await createAgentMemory(alice.id, {
      kind: 'preference',
      content: '即使索引挂掉也要落库',
      scope: ['all'],
    });
    await waitForIndexIdle();

    // The row is committed and the failure was logged, not thrown.
    const rows = await getDb().select().from(agentMemory).where(eq(agentMemory.id, created.id));
    expect(rows).toHaveLength(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[retrieval]'), expect.anything());
    // Meili write still went through despite the vector-path failure.
    expect(meili.upsertDocuments).toHaveBeenCalledWith('memories', [
      expect.objectContaining({ id: created.id }),
    ]);
    errSpy.mockRestore();
  });
});

describe('memory distill index hooks', () => {
  it('reindexes added/updated rows and removes dropped rows after the distill transaction', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();

    const updateId = await insertMemory(alice.id, '旧表述');
    const dropId = await insertMemory(alice.id, '过时的记忆');
    const keepId = await insertMemory(alice.id, '保留的记忆');
    await seedFeedback(alice.id);

    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_memories', {
          keep: [keepId],
          update: [{ id: updateId, content: '合并后的表述' }],
          add: [{ kind: 'pattern', content: '蒸馏出的模式', scope: ['cluster'] }],
          drop: [dropId],
        }),
      ),
    ]);
    await runDistill(alice.id);
    await waitForIndexIdle();

    // The direct insertMemory calls above bypassed the hooks: every upsert we
    // see came from the distill commit.
    const upsertedPoints = qdrant.upsertPoints.mock.calls.flatMap((call) => call[1]);
    const upsertedByContent = new Map(
      upsertedPoints.map((point) => [String(point.payload.content), point]),
    );
    expect(upsertedByContent.get('蒸馏出的模式')?.payload.scope).toEqual(['cluster']);
    expect(upsertedByContent.get('蒸馏出的模式')?.payload.kind).toBe('pattern');
    expect(upsertedByContent.get('合并后的表述')?.id).toBe(updateId);
    // Untouched rows are not reindexed.
    expect(upsertedByContent.has('保留的记忆')).toBe(false);
    expect(upsertedByContent.has('旧表述')).toBe(false);

    const upsertedDocs = meili.upsertDocuments.mock.calls.flatMap((call) => call[1]);
    expect(upsertedDocs.some((doc) => doc.content === '蒸馏出的模式')).toBe(true);
    expect(upsertedDocs.some((doc) => doc.id === updateId && doc.content === '合并后的表述')).toBe(
      true,
    );

    expect(qdrant.deletePoints).toHaveBeenCalledWith('agent_memory', [dropId]);
    expect(meili.deleteDocuments).toHaveBeenCalledWith('memories', [dropId]);
  });
});
