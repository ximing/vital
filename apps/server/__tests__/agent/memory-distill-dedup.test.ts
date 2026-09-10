/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
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
import { enqueueAgentJob, processDueAgentJobs } from '../../src/agent/jobs.js';
import { buildDistillPrompt } from '../../src/agent/prompts.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, agentJobs, agentMemory } from '../../src/db/schema.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type QdrantClient,
} from '../../src/retrieval/registry.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

let app: FastifyInstance;

function fakeQdrant() {
  return {
    ensureCollection: vi.fn<QdrantClient['ensureCollection']>(() => Promise.resolve()),
    upsertPoints: vi.fn<QdrantClient['upsertPoints']>(() => Promise.resolve()),
    queryPoints: vi.fn<QdrantClient['queryPoints']>(() => Promise.resolve([])),
    deletePoints: vi.fn<QdrantClient['deletePoints']>(() => Promise.resolve()),
    scrollPoints: vi.fn<QdrantClient['scrollPoints']>(() => Promise.resolve([])),
  };
}

let qdrant: ReturnType<typeof fakeQdrant>;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  qdrant = fakeQdrant();
  // embedding/meili stay null: post-commit reindex hooks no-op in this file.
  setRetrievalClientsForTest({ embedding: null, qdrant, meili: null, rerank: null });
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

async function runDistill(
  userId: string,
  payload: { date: string; mode?: 'incremental' | 'maintenance'; trigger?: string } = {
    date: '2026-W37',
  },
): Promise<void> {
  await enqueueAgentJob(getDb(), {
    userId,
    jobType: 'memory.distill',
    payload,
    dedupKey: `memory.distill:${userId}:${randomUUID()}`,
    scheduledAt: new Date(Date.now() - 1_000),
  });
  const n = await processDueAgentJobs(new Date());
  expect(n).toBe(1);
  const [job] = await getDb()
    .select()
    .from(agentJobs)
    .where(eq(agentJobs.userId, userId));
  expect(job!.jobType).toBe('memory.distill');
  expect(job!.status).toBe('done');
  expect(job!.lastError).toBeNull();
}

function contextText(ctx: Context): string {
  return ctx.messages
    .filter((m) => m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');
}

describe('buildDistillPrompt similar pairs', () => {
  const base = {
    actions: [
      {
        actionType: 'outcome.headline',
        feedback: 'accepted',
        summary: '{"headline":"提案"}',
        editedSummary: null,
      },
    ],
    existingMemory: [
      { id: 'm1', kind: 'pattern', content: '周末不排任务', manual: false, scope: ['all'] },
      { id: 'm2', kind: 'pattern', content: '周末不要安排任务', manual: false, scope: ['all'] },
    ],
  };

  it('annotates semantically similar pairs next to the existing memory list', () => {
    const { system, user } = buildDistillPrompt({
      ...base,
      similarPairs: [
        ['m1', 'm2'],
        ['m3', 'm4'],
      ],
    });
    expect(user).toContain('语义高度相似');
    expect(user).toContain('update 合并');
    expect(user).toContain('id=m1 ⇔ id=m2');
    expect(user).toContain('id=m3 ⇔ id=m4');
    // The annotation sits in the user prompt near the memory list, not system.
    expect(system).not.toContain('id=m1 ⇔ id=m2');
  });

  it('is byte-identical to the current prompt when pairs are absent or empty', () => {
    const plain = buildDistillPrompt(base);
    expect(buildDistillPrompt({ ...base, similarPairs: [] })).toEqual(plain);
    expect(plain.user).not.toContain('语义高度相似');
  });
});

describe('memory.distill semantic dedup annotation', () => {
  it('writes similar pairs into the distill prompt, filtering ids no longer in PG', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    const m1 = await insertMemory(alice.id, '周末不排任务');
    const m2 = await insertMemory(alice.id, '周末不要安排任务');
    await seedFeedback(alice.id);
    qdrant.scrollPoints.mockResolvedValue([
      { id: m1, payload: {}, vector: [1, 0] },
      { id: m2, payload: {}, vector: [0.999, 0.04] },
      // Index lag: this id is no longer in PG, its pairs must be filtered out.
      { id: 'ghost-id', payload: {}, vector: [0.99, 0.1] },
    ]);

    let seen: Context | null = null;
    faux.setResponses([
      (context) => {
        seen = context;
        return fauxAssistantMessage(
          fauxToolCall('submit_memories', { keep: [m1, m2], update: [], add: [], drop: [] }),
        );
      },
    ]);
    await runDistill(alice.id);

    expect(seen).not.toBeNull();
    const text = contextText(seen as unknown as Context);
    expect(text).toContain('语义高度相似');
    expect(text).toContain(`id=${m1} ⇔ id=${m2}`);
    expect(text).not.toContain('ghost-id');
  });

  it('carries the annotation in maintenance mode too', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    const m1 = await insertMemory(alice.id, '记忆一');
    const m2 = await insertMemory(alice.id, '记忆二');
    qdrant.scrollPoints.mockResolvedValue([
      { id: m1, payload: {}, vector: [1, 0] },
      { id: m2, payload: {}, vector: [0.999, 0.04] },
    ]);

    let seen: Context | null = null;
    faux.setResponses([
      (context) => {
        seen = context;
        return fauxAssistantMessage(
          fauxToolCall('submit_memories', { keep: [m1, m2], update: [], add: [], drop: [] }),
        );
      },
    ]);
    await runDistill(alice.id, { date: '2026-09-10', mode: 'maintenance', trigger: 'daily-maintenance' });

    expect(seen).not.toBeNull();
    const text = contextText(seen as unknown as Context);
    expect(text).toContain('语义高度相似');
    expect(text).toContain(`id=${m1} ⇔ id=${m2}`);
  });

  it('distills normally when the similarity lookup fails', async () => {
    const alice = await setupFauxUser('alice');
    const faux = installFaux();
    await insertMemory(alice.id, '保持不动');
    await seedFeedback(alice.id);
    qdrant.scrollPoints.mockRejectedValue(new Error('qdrant down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let seen: Context | null = null;
    faux.setResponses([
      (context) => {
        seen = context;
        return fauxAssistantMessage(
          fauxToolCall('submit_memories', { keep: [], update: [], add: [], drop: [] }),
        );
      },
    ]);
    await runDistill(alice.id);

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[retrieval]'), expect.anything());
    errSpy.mockRestore();
    expect(seen).not.toBeNull();
    expect(contextText(seen as unknown as Context)).not.toContain('语义高度相似');
    const rows = await getDb().select().from(agentMemory).where(eq(agentMemory.userId, alice.id));
    expect(rows).toHaveLength(1);
  });
});
