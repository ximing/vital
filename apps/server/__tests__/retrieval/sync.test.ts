import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentMemory, lists, tasks, type AgentMemoryRow, type TaskRow } from '../../src/db/schema.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type EmbeddingClient,
  type MeiliClient,
  type QdrantClient,
} from '../../src/retrieval/registry.js';
import { syncUserIndexes } from '../../src/retrieval/sync.js';
import { resetDb } from '../helpers/db.js';
import { registerUser } from '../helpers/session.js';

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

async function insertMemory(userId: string, content: string): Promise<AgentMemoryRow> {
  const now = new Date();
  const [row] = await getDb()
    .insert(agentMemory)
    .values({
      id: randomUUID(),
      userId,
      kind: 'preference',
      content,
      scope: ['all'],
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!row) throw new Error('memory insert failed');
  return row;
}

async function insertTask(
  userId: string,
  title: string,
  overrides: Partial<typeof tasks.$inferInsert> = {},
): Promise<TaskRow> {
  const db = getDb();
  const [inbox] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.userId, userId), eq(lists.kind, 'inbox')))
    .limit(1);
  if (!inbox) throw new Error('missing inbox list');
  const now = new Date();
  const [row] = await db
    .insert(tasks)
    .values({
      id: randomUUID(),
      userId,
      listId: inbox.id,
      title,
      timezone: 'Asia/Shanghai',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('task insert failed');
  return row;
}

describe('syncUserIndexes', () => {
  it('returns zero counts without touching anything when no store is configured', async () => {
    setRetrievalClientsForTest({ embedding: null, qdrant: null, meili: null, rerank: null });
    const user = await registerUser(app);
    await insertMemory(user.id, '偏好手写记忆');

    await expect(syncUserIndexes(user.id)).resolves.toEqual({ memories: 0, tasks: 0, removed: 0 });
  });

  it('ensures collections/indexes, upserts every PG row and reports counts', async () => {
    const qdrant = fakeQdrant();
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding: fakeEmbedding(), qdrant, meili, rerank: null });
    const user = await registerUser(app);
    const memory = await insertMemory(user.id, '写报告先列提纲');
    const task = await insertTask(user.id, '整理季度总结');

    const stats = await syncUserIndexes(user.id);

    expect(stats).toEqual({ memories: 1, tasks: 1, removed: 0 });
    expect(qdrant.ensureCollection).toHaveBeenCalledWith('agent_memory');
    expect(qdrant.ensureCollection).toHaveBeenCalledWith('tasks');
    expect(meili.ensureIndex).toHaveBeenCalledWith('memories');
    expect(meili.ensureIndex).toHaveBeenCalledWith('tasks');
    expect(qdrant.upsertPoints).toHaveBeenCalledWith(
      'agent_memory',
      [expect.objectContaining({ id: memory.id })],
    );
    expect(qdrant.upsertPoints).toHaveBeenCalledWith(
      'tasks',
      [expect.objectContaining({ id: task.id })],
    );
    expect(meili.upsertDocuments).toHaveBeenCalledWith(
      'memories',
      [expect.objectContaining({ id: memory.id })],
    );
    expect(meili.upsertDocuments).toHaveBeenCalledWith(
      'tasks',
      [expect.objectContaining({ id: task.id })],
    );
  });

  it('deletes indexed ids that no longer exist in PG (including soft-deleted tasks)', async () => {
    const user = await registerUser(app);
    const memory = await insertMemory(user.id, '仅存记忆');
    const alive = await insertTask(user.id, '未删任务');
    const deleted = await insertTask(user.id, '已删任务', { deletedAt: new Date() });
    const qdrant = fakeQdrant({
      agent_memory: [
        { id: memory.id, payload: { userId: user.id } },
        { id: 'stale-mem-q', payload: { userId: user.id } },
      ],
      tasks: [
        { id: alive.id, payload: { userId: user.id } },
        { id: deleted.id, payload: { userId: user.id } },
        { id: 'stale-task-q', payload: { userId: user.id } },
      ],
    });
    const meili = fakeMeili({
      memories: [{ id: memory.id }],
      tasks: [{ id: alive.id }, { id: 'stale-task-m' }],
    });
    setRetrievalClientsForTest({ embedding: fakeEmbedding(), qdrant, meili, rerank: null });

    const stats = await syncUserIndexes(user.id);

    expect(stats).toEqual({ memories: 1, tasks: 1, removed: 4 });
    expect(qdrant.deletePoints).toHaveBeenCalledWith('agent_memory', ['stale-mem-q']);
    expect(qdrant.deletePoints).toHaveBeenCalledWith('tasks', [deleted.id, 'stale-task-q']);
    expect(meili.deleteDocuments).toHaveBeenCalledWith('tasks', ['stale-task-m']);
    expect(meili.deleteDocuments).not.toHaveBeenCalledWith('memories', expect.anything());
    // The soft-deleted task must not be re-indexed.
    const taskUpserts = qdrant.upsertPoints.mock.calls.filter(([name]) => name === 'tasks');
    const upsertedIds = taskUpserts.flatMap(([, points]) => points.map((p) => p.id));
    expect(upsertedIds).toEqual([alive.id]);
  });

  it('scrolls and lists with a userId filter so other users are untouched', async () => {
    const qdrant = fakeQdrant();
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding: fakeEmbedding(), qdrant, meili, rerank: null });
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    await insertMemory(bob.id, '别人的记忆');

    const stats = await syncUserIndexes(alice.id);

    expect(stats).toEqual({ memories: 0, tasks: 0, removed: 0 });
    expect(qdrant.scrollPoints).toHaveBeenCalledWith(
      'agent_memory',
      { must: [{ key: 'userId', match: { value: alice.id } }] },
    );
    expect(meili.listDocuments).toHaveBeenCalledWith(
      'memories',
      expect.objectContaining({ filter: `userId = '${alice.id}'` }),
    );
    const upserted = qdrant.upsertPoints.mock.calls.flatMap(([, points]) => points.map((p) => p.id));
    expect(upserted).toEqual([]);
  });

  it('works with only meilisearch configured (qdrant side skipped)', async () => {
    const meili = fakeMeili({ memories: [{ id: 'stale-mem-m' }] });
    setRetrievalClientsForTest({ embedding: null, qdrant: null, meili, rerank: null });
    const user = await registerUser(app);
    const memory = await insertMemory(user.id, '只进全文索引');

    const stats = await syncUserIndexes(user.id);

    expect(stats).toEqual({ memories: 1, tasks: 0, removed: 1 });
    expect(meili.ensureIndex).toHaveBeenCalledWith('memories');
    expect(meili.upsertDocuments).toHaveBeenCalledWith(
      'memories',
      [expect.objectContaining({ id: memory.id })],
    );
    expect(meili.deleteDocuments).toHaveBeenCalledWith('memories', ['stale-mem-m']);
  });

  it('propagates infra errors so the job can retry instead of silently passing', async () => {
    const qdrant = fakeQdrant();
    qdrant.scrollPoints.mockRejectedValue(new Error('qdrant down'));
    setRetrievalClientsForTest({ embedding: fakeEmbedding(), qdrant, meili: fakeMeili(), rerank: null });
    const user = await registerUser(app);

    await expect(syncUserIndexes(user.id)).rejects.toThrow('qdrant down');
  });
});
