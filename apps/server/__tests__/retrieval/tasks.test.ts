/* eslint-disable @typescript-eslint/no-non-null-assertion -- test assertions */
/* eslint-disable @typescript-eslint/unbound-method -- vi.mocked on fake client methods */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRow } from '../../src/db/schema.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type EmbeddingClient,
  type MeiliClient,
  type QdrantClient,
  type RerankClient,
} from '../../src/retrieval/registry.js';
import {
  groupTasksBySimilarity,
  indexTask,
  removeTaskIndex,
  searchSimilarTasks,
  trackTaskIndexJob,
  waitForTaskIndexIdle,
} from '../../src/retrieval/tasks.js';

function makeTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  const now = new Date('2026-09-10T00:00:00Z');
  return {
    id: 'task-1',
    userId: 'u1',
    listId: 'l1',
    parentId: null,
    outcomeId: null,
    estimateMinutes: null,
    deferCount: 0,
    delegable: false,
    habitId: null,
    habitSeq: null,
    habitKey: null,
    title: '写季度总结',
    notesMd: '# 备注\n给**部门**汇报用',
    status: 'todo',
    priority: 3,
    pinned: false,
    dueAt: null,
    startAt: null,
    reminderMode: null,
    reminderOffsetMinutes: null,
    reminderAt: null,
    isAllDay: false,
    timezone: 'Asia/Shanghai',
    recurrenceRrule: null,
    recurrenceKind: null,
    recurrenceDtstart: null,
    completedAt: null,
    sortOrder: 1024,
    deletedAt: null,
    searchTsv: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function fakeEmbedding(vectors: number[][] = [[1, 0, 0]]): EmbeddingClient {
  return { embedTexts: vi.fn<EmbeddingClient['embedTexts']>().mockResolvedValue(vectors) };
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

function fakeRerank(results: { index: number; score: number }[] = []): RerankClient {
  return { rerankTexts: vi.fn<RerankClient['rerankTexts']>().mockResolvedValue(results) };
}

beforeEach(() => {
  resetRetrievalClientsForTest();
});

afterEach(() => {
  resetRetrievalClientsForTest();
});

describe('indexTask', () => {
  it('upserts qdrant point and meili document derived from the task row', async () => {
    const embedding = fakeEmbedding([[0.1, 0.2, 0.3]]);
    const qdrant = fakeQdrant();
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding, qdrant, meili, rerank: null });

    await indexTask(makeTaskRow({ outcomeId: 'o1', parentId: 'p1', status: 'doing' }));

    expect(embedding.embedTexts).toHaveBeenCalledTimes(1);
    const [texts, opts] = vi.mocked(embedding.embedTexts).mock.calls[0]!;
    expect(opts).toEqual({ userId: 'u1' });
    expect(texts).toHaveLength(1);
    // Index text = title + '\n' + markdown-stripped notes.
    expect(texts[0]).toBe('写季度总结\n备注 给部门汇报用');

    expect(qdrant.upsertPoints).toHaveBeenCalledTimes(1);
    const [collection, points] = vi.mocked(qdrant.upsertPoints).mock.calls[0]!;
    expect(collection).toBe('tasks');
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({
      id: 'task-1',
      vector: [0.1, 0.2, 0.3],
      payload: {
        userId: 'u1',
        status: 'doing',
        outcomeId: 'o1',
        parentId: 'p1',
        title: '写季度总结',
        content: '写季度总结\n备注 给部门汇报用',
      },
    });

    expect(meili.upsertDocuments).toHaveBeenCalledTimes(1);
    const [uid, docs] = vi.mocked(meili.upsertDocuments).mock.calls[0]!;
    expect(uid).toBe('tasks');
    expect(docs).toEqual([
      {
        id: 'task-1',
        userId: 'u1',
        type: 'task',
        title: '写季度总结',
        notes: '备注 给部门汇报用',
        status: 'doing',
        listId: 'l1',
      },
    ]);
  });

  it('truncates the index text to 500 characters', async () => {
    const embedding = fakeEmbedding();
    const qdrant = fakeQdrant();
    setRetrievalClientsForTest({ embedding, qdrant, meili: null, rerank: null });

    await indexTask(makeTaskRow({ notesMd: 'x'.repeat(1000) }));

    const [texts] = vi.mocked(embedding.embedTexts).mock.calls[0]!;
    expect(texts![0]!.length).toBe(500);
    const [, points] = vi.mocked(qdrant.upsertPoints).mock.calls[0]!;
    expect((points![0]!.payload['content'] as string).length).toBe(500);
  });

  it('is a no-op when no clients are configured', async () => {
    setRetrievalClientsForTest({ embedding: null, qdrant: null, meili: null, rerank: null });
    await expect(indexTask(makeTaskRow())).resolves.toBeUndefined();
  });

  it('writes the surviving side and reports the failed one as an aggregated error', async () => {
    const embedding = fakeEmbedding();
    const qdrant = fakeQdrant({
      upsertPoints: vi.fn<QdrantClient['upsertPoints']>().mockRejectedValue(new Error('qdrant down')),
    });
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding, qdrant, meili, rerank: null });

    await expect(indexTask(makeTaskRow())).rejects.toThrow(AggregateError);
    expect(meili.upsertDocuments).toHaveBeenCalledTimes(1);
  });
});

describe('removeTaskIndex', () => {
  it('deletes the point and document from both sides', async () => {
    const qdrant = fakeQdrant();
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding: null, qdrant, meili, rerank: null });

    await removeTaskIndex('task-1');
    expect(qdrant.deletePoints).toHaveBeenCalledWith('tasks', ['task-1']);
    expect(meili.deleteDocuments).toHaveBeenCalledWith('tasks', ['task-1']);
  });

  it('is a no-op when nothing is configured', async () => {
    setRetrievalClientsForTest({ embedding: null, qdrant: null, meili: null, rerank: null });
    await expect(removeTaskIndex('task-1')).resolves.toBeUndefined();
  });
});

describe('searchSimilarTasks', () => {
  it('returns null when retrieval clients are not configured', async () => {
    setRetrievalClientsForTest({ embedding: null, qdrant: null, meili: null, rerank: null });
    await expect(searchSimilarTasks({ userId: 'u1', query: '总结', limit: 5 })).resolves.toBeNull();
  });

  it('fuses vector + sparse hits, reranks, excludes the task itself, and filters by user/status', async () => {
    const embedding = fakeEmbedding([[1, 0, 0]]);
    const qdrant = fakeQdrant({
      queryPoints: vi.fn<QdrantClient['queryPoints']>().mockResolvedValue([
        { id: 'a', score: 0.9, payload: { title: '写年度总结', content: '写年度总结' } },
        { id: 'b', score: 0.8, payload: { title: '写月度总结', content: '写月度总结' } },
      ]),
    });
    const meili = fakeMeili({
      search: vi.fn<MeiliClient['search']>().mockResolvedValue([
        { id: 'self', title: '写季度总结' },
        { id: 'b', title: '写月度总结' },
        { id: 'c', title: '写周报' },
      ]),
    });
    // Fused order: b (both lists), a (vector), self (meili), c (meili).
    // Rerank reorders: c first, then b, then a; self left out by rerank.
    const rerank = fakeRerank([
      { index: 3, score: 0.99 },
      { index: 0, score: 0.5 },
      { index: 1, score: 0.4 },
    ]);
    setRetrievalClientsForTest({ embedding, qdrant, meili, rerank });

    const hits = await searchSimilarTasks({
      userId: 'u1',
      query: '写季度总结',
      excludeId: 'self',
      status: 'done',
      limit: 3,
    });

    // Qdrant filter: must userId + status, must_not the excluded id.
    const [collection, , filter, limit] = vi.mocked(qdrant.queryPoints).mock.calls[0]!;
    expect(collection).toBe('tasks');
    expect(limit).toBe(20);
    expect(filter).toEqual({
      must: [
        { key: 'userId', match: { value: 'u1' } },
        { key: 'status', match: { value: 'done' } },
      ],
      must_not: [{ has_id: ['self'] }],
    });

    const [uid, searchQuery] = vi.mocked(meili.search).mock.calls[0]!;
    expect(uid).toBe('tasks');
    expect(searchQuery.q).toBe('写季度总结');
    expect(searchQuery.filter).toBe("userId = 'u1' AND status = 'done'");
    expect(searchQuery.limit).toBe(20);

    // Rerank receives the fused candidates (both-lists id 'b' fused first).
    const [rq, docs] = vi.mocked(rerank.rerankTexts).mock.calls[0]!;
    expect(rq).toBe('写季度总结');
    expect(docs).toHaveLength(4);

    // Rerank order wins; 'self' excluded even though meili returned it.
    expect(hits).not.toBeNull();
    expect(hits!.map((h) => h.id)).toEqual(['c', 'b', 'a']);
    expect(hits!.map((h) => h.title)).toEqual(['写周报', '写月度总结', '写年度总结']);
  });

  it('respects the limit and works without meili (vector-only)', async () => {
    const embedding = fakeEmbedding([[1, 0]]);
    const qdrant = fakeQdrant({
      queryPoints: vi.fn<QdrantClient['queryPoints']>().mockResolvedValue([
        { id: 'a', score: 0.9, payload: { title: '任务A' } },
        { id: 'b', score: 0.8, payload: { title: '任务B' } },
      ]),
    });
    const rerank = fakeRerank([
      { index: 0, score: 0.9 },
      { index: 1, score: 0.8 },
    ]);
    setRetrievalClientsForTest({ embedding, qdrant, meili: null, rerank });

    const hits = await searchSimilarTasks({ userId: 'u1', query: '任务', limit: 1 });
    expect(hits).toEqual([{ id: 'a', title: '任务A' }]);
    // No status filter → must only carries userId, no must_not without excludeId.
    const [, , filter] = vi.mocked(qdrant.queryPoints).mock.calls[0]!;
    expect(filter).toEqual({ must: [{ key: 'userId', match: { value: 'u1' } }] });
  });
});

describe('groupTasksBySimilarity', () => {
  it('greedily groups vectors by cosine >= 0.8, keeping singletons', () => {
    const groups = groupTasksBySimilarity([
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [0.999, 0.0447] }, // ~0.999 cosine with a
      { id: 'c', vector: [0, 1] }, // orthogonal → own group
      { id: 'd', vector: [0.0447, 0.999] }, // close to c
    ]);
    expect(groups).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('trackTaskIndexJob / waitForTaskIndexIdle', () => {
  it('waits until tracked fire-and-forget jobs settle', async () => {
    let resolveJob: (() => void) | null = null;
    trackTaskIndexJob(
      new Promise<void>((resolve) => {
        resolveJob = resolve;
      }),
    );
    let idle = false;
    const waiter = waitForTaskIndexIdle().then(() => {
      idle = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(idle).toBe(false);
    resolveJob!();
    await waiter;
    expect(idle).toBe(true);
  });

  it('swallows rejections while still draining', async () => {
    trackTaskIndexJob(Promise.reject(new Error('boom')).catch(() => undefined));
    await expect(waitForTaskIndexIdle()).resolves.toBeUndefined();
  });
});
