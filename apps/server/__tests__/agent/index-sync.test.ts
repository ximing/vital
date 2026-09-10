/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueAgentJob, processDueAgentJobs } from '../../src/agent/jobs.js';
import { isRetryableAgentJobError } from '../../src/agent/job-runtime.js';
import { processAgentJob } from '../../src/agent/processors.js';
import { runAgentScheduler } from '../../src/agent/scheduler.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import {
  agentExecutions,
  agentJobs,
  agentMemory,
  inboxItems,
  lists,
  outcomes,
  tasks,
  users,
  type AgentJobRow,
} from '../../src/db/schema.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type EmbeddingClient,
  type MeiliClient,
  type QdrantClient,
} from '../../src/retrieval/registry.js';
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

function fakeEmbedding() {
  return {
    embedTexts: vi.fn<EmbeddingClient['embedTexts']>(() => Promise.resolve([[0.1, 0.2, 0.3]])),
  };
}

function fakeQdrant(scrolled: Record<string, { id: string; payload: Record<string, unknown> }[]> = {}) {
  return {
    ensureCollection: vi.fn<QdrantClient['ensureCollection']>(() => Promise.resolve()),
    upsertPoints: vi.fn<QdrantClient['upsertPoints']>(() => Promise.resolve()),
    queryPoints: vi.fn<QdrantClient['queryPoints']>(() => Promise.resolve([])),
    deletePoints: vi.fn<QdrantClient['deletePoints']>(() => Promise.resolve()),
    scrollPoints: vi.fn<QdrantClient['scrollPoints']>((name) =>
      Promise.resolve(scrolled[name] ?? []),
    ),
  };
}

function fakeMeili(listed: Record<string, Record<string, unknown>[]> = {}) {
  return {
    ensureIndex: vi.fn<MeiliClient['ensureIndex']>(() => Promise.resolve()),
    upsertDocuments: vi.fn<MeiliClient['upsertDocuments']>(() => Promise.resolve()),
    deleteDocuments: vi.fn<MeiliClient['deleteDocuments']>(() => Promise.resolve()),
    search: vi.fn<MeiliClient['search']>(() => Promise.resolve([])),
    multiSearch: vi.fn<MeiliClient['multiSearch']>(() => Promise.resolve({})),
    listDocuments: vi.fn<MeiliClient['listDocuments']>((uid) =>
      Promise.resolve({ results: listed[uid] ?? [], total: (listed[uid] ?? []).length }),
    ),
  };
}

/** agent_executions.jobId is FK-ed to agent_jobs — processors need a persisted job. */
async function persistJob(userId: string): Promise<AgentJobRow> {
  const id = await enqueueAgentJob(getDb(), {
    userId,
    jobType: 'index.sync',
    payload: { date: '2026-09-10' },
    dedupKey: `test:index.sync:${randomUUID()}`,
    scheduledAt: new Date(),
  });
  const [row] = await getDb().select().from(agentJobs).where(eq(agentJobs.id, id!));
  return row!;
}

async function latestExecution(jobId: string) {
  const [row] = await getDb()
    .select()
    .from(agentExecutions)
    .where(eq(agentExecutions.jobId, jobId))
    .limit(1);
  return row;
}

describe('processIndexSync', () => {
  it('is a known job type: runs to done and records a zero summary when stores are unconfigured', async () => {
    setRetrievalClientsForTest({ embedding: null, qdrant: null, meili: null, rerank: null });
    const alice = await registerUser(app);
    const job = await persistJob(alice.id);

    await expect(processAgentJob(job, new Date())).resolves.toBe('done');

    const execution = await latestExecution(job.id);
    expect(execution?.status).toBe('succeeded');
    expect(execution?.resultSummary).toBe('同步记忆 0 条、任务 0 条、线程 0 条、收集箱 0 条，清理 0 条');
  });

  it('syncs PG rows into the indexes, prunes stale ids and summarizes the counts', async () => {
    const alice = await registerUser(app);
    const db = getDb();
    await db.insert(agentMemory).values({
      id: randomUUID(), userId: alice.id, kind: 'pattern', content: '站会先说阻塞',
    });
    const [inbox] = await db.select().from(lists)
      .where(and(eq(lists.userId, alice.id), eq(lists.kind, 'inbox'))).limit(1);
    await db.insert(tasks).values({
      id: randomUUID(), userId: alice.id, listId: inbox!.id, title: '写月报', timezone: 'Asia/Shanghai',
    });
    await db.insert(outcomes).values({
      id: randomUUID(), userId: alice.id, name: '上线 Q3',
    });
    await db.insert(inboxItems).values({
      id: randomUUID(), userId: alice.id, title: '稍后读：RRF', status: 'unread', source: 'extension',
    });
    const qdrant = fakeQdrant({
      agent_memory: [{ id: 'stale-mem', payload: { userId: alice.id } }],
    });
    const meili = fakeMeili({
      tasks: [{ id: 'stale-task' }],
      outcomes: [{ id: 'stale-outcome' }],
      inbox: [{ id: 'stale-inbox' }],
    });
    setRetrievalClientsForTest({ embedding: fakeEmbedding(), qdrant, meili, rerank: null });
    const job = await persistJob(alice.id);

    await expect(processAgentJob(job, new Date())).resolves.toBe('done');

    expect(qdrant.deletePoints).toHaveBeenCalledWith('agent_memory', ['stale-mem']);
    expect(meili.deleteDocuments).toHaveBeenCalledWith('tasks', ['stale-task']);
    expect(meili.deleteDocuments).toHaveBeenCalledWith('outcomes', ['stale-outcome']);
    expect(meili.deleteDocuments).toHaveBeenCalledWith('inbox', ['stale-inbox']);
    const execution = await latestExecution(job.id);
    expect(execution?.resultSummary).toBe('同步记忆 1 条、任务 1 条、线程 1 条、收集箱 1 条，清理 4 条');
  });

  it('external service failures retry with backoff instead of silently completing', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const qdrant = fakeQdrant();
    qdrant.scrollPoints.mockRejectedValue(new Error('qdrant down'));
    setRetrievalClientsForTest({ embedding: fakeEmbedding(), qdrant, meili: fakeMeili(), rerank: null });

    await expect(processAgentJob(await persistJob(alice.id), new Date())).rejects.toSatisfy(
      (err: unknown) => isRetryableAgentJobError(err),
    );

    // claimDueJobs serializes per user+jobType, so the claimed job must be
    // the only pending index.sync of its user.
    const id = await enqueueAgentJob(getDb(), {
      userId: bob.id,
      jobType: 'index.sync',
      payload: { date: '2026-09-10' },
      dedupKey: `index.sync:${bob.id}:2026-09-10`,
      scheduledAt: new Date(),
    });
    expect(id).toBeTruthy();
    await processDueAgentJobs(new Date(Date.now() + 5_000));
    const [row] = await getDb().select().from(agentJobs).where(eq(agentJobs.id, id!));
    expect(row!.status).toBe('pending');
    expect(row!.attemptCount).toBe(1);
    expect(row!.nextAttemptAt).not.toBeNull();
  });
});

describe('scheduler index.sync delivery', () => {
  it('delivers index.sync once per active user per day', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const res = await injectJson(app, {
      method: 'POST', url: '/api/v1/tasks', token: alice.token,
      payload: { title: '保持活跃', listId },
    });
    expect(res.statusCode).toBe(201);
    const now = new Date();

    await runAgentScheduler(now);
    await runAgentScheduler(now);

    const [user] = await getDb().select().from(users).where(eq(users.id, alice.id));
    const day = DateTime.fromJSDate(now).setZone(user!.timezone).toISODate()!;
    const jobs = await getDb().select().from(agentJobs).where(
      and(eq(agentJobs.userId, alice.id), eq(agentJobs.jobType, 'index.sync')),
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.dedupKey).toBe(`index.sync:${alice.id}:${day}`);
    expect(jobs[0]!.payload).toMatchObject({ date: day });
  });

  it('does not deliver index.sync to inactive users', async () => {
    const alice = await registerUser(app);

    await runAgentScheduler(new Date());

    const jobs = await getDb().select().from(agentJobs).where(
      and(eq(agentJobs.userId, alice.id), eq(agentJobs.jobType, 'index.sync')),
    );
    expect(jobs).toEqual([]);
  });
});
