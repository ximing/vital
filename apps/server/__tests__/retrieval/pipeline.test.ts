import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMemoryRow } from '../../src/db/schema.js';
import {
  indexMemory,
  removeMemoryIndex,
  searchMemories,
  trackIndexJob,
  waitForIndexIdle,
} from '../../src/retrieval/pipeline.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type EmbeddingClient,
  type MeiliClient,
  type QdrantClient,
  type RerankClient,
} from '../../src/retrieval/registry.js';
import { rrfMerge } from '../../src/retrieval/rrf.js';

function memoryRow(overrides: Partial<AgentMemoryRow> = {}): AgentMemoryRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    userId: 'user-1',
    version: 1,
    kind: 'preference',
    content: '不要在周报里用「冲刺」',
    sourceCount: 0,
    manual: true,
    scope: ['all'],
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

function fakeEmbedding(vectors: number[][] = [[0.1, 0.2, 0.3]]) {
  return { embedTexts: vi.fn<EmbeddingClient['embedTexts']>(() => Promise.resolve(vectors)) };
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

function fakeMeili(hits: Record<string, unknown>[] = []) {
  return {
    ensureIndex: vi.fn<MeiliClient['ensureIndex']>(() => Promise.resolve()),
    upsertDocuments: vi.fn<MeiliClient['upsertDocuments']>(() => Promise.resolve()),
    deleteDocuments: vi.fn<MeiliClient['deleteDocuments']>(() => Promise.resolve()),
    search: vi.fn<MeiliClient['search']>(() => Promise.resolve(hits)),
    multiSearch: vi.fn<MeiliClient['multiSearch']>(() => Promise.resolve({})),
    listDocuments: vi.fn<MeiliClient['listDocuments']>(() =>
      Promise.resolve({ results: [], total: 0 }),
    ),
  };
}

function fakeRerank(results: { index: number; score: number }[] = []) {
  return { rerankTexts: vi.fn<RerankClient['rerankTexts']>(() => Promise.resolve(results)) };
}

afterEach(() => {
  resetRetrievalClientsForTest();
});

describe('rrfMerge', () => {
  it('fuses ranked lists by reciprocal rank score, deduping shared ids', () => {
    // a: 1/61, b: 1/62 + 1/61, c: 1/62
    expect(rrfMerge([['a', 'b'], ['b', 'c']])).toEqual(['b', 'a', 'c']);
  });

  it('handles empty input', () => {
    expect(rrfMerge([])).toEqual([]);
    expect(rrfMerge([[], []])).toEqual([]);
  });

  it('weights ranks by k: small k rewards top ranks, large k rewards list coverage', () => {
    // 'e' is rank 4 in two lists; 'a' is rank 1 in one list.
    const lists = [['a'], ['b', 'c', 'd', 'e'], ['f', 'g', 'h', 'e']];
    // k=1: a = 1/2 > e = 1/5 + 1/5
    expect(rrfMerge(lists, 1)[0]).toBe('a');
    // k=60 (default): e = 1/64 + 1/64 > a = 1/61
    expect(rrfMerge(lists)[0]).toBe('e');
    expect(rrfMerge(lists, 60)[0]).toBe('e');
  });
});

describe('indexMemory', () => {
  it('embeds the content and upserts vector + document to both stores', async () => {
    const embedding = fakeEmbedding([[0.1, 0.2]]);
    const qdrant = fakeQdrant();
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding, qdrant, meili, rerank: null });
    const row = memoryRow();

    await indexMemory(row);

    expect(embedding.embedTexts).toHaveBeenCalledWith(['不要在周报里用「冲刺」'], {
      userId: 'user-1',
    });
    expect(qdrant.upsertPoints).toHaveBeenCalledWith('agent_memory', [
      {
        id: row.id,
        vector: [0.1, 0.2],
        payload: {
          userId: 'user-1',
          scope: ['all'],
          kind: 'preference',
          manual: true,
          content: '不要在周报里用「冲刺」',
        },
      },
    ]);
    expect(meili.upsertDocuments).toHaveBeenCalledWith('memories', [
      {
        id: row.id,
        userId: 'user-1',
        content: '不要在周报里用「冲刺」',
        kind: 'preference',
        manual: true,
        scope: ['all'],
      },
    ]);
  });

  it('does not let a qdrant failure block the meili write, then throws an aggregated error', async () => {
    const embedding = fakeEmbedding();
    const qdrant = fakeQdrant();
    qdrant.upsertPoints.mockRejectedValue(new Error('qdrant down'));
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding, qdrant, meili, rerank: null });

    await expect(indexMemory(memoryRow())).rejects.toThrow();
    expect(meili.upsertDocuments).toHaveBeenCalled();
  });

  it('does not let a meili failure block the qdrant write, then throws an aggregated error', async () => {
    const embedding = fakeEmbedding();
    const qdrant = fakeQdrant();
    const meili = fakeMeili();
    meili.upsertDocuments.mockRejectedValue(new Error('meili down'));
    setRetrievalClientsForTest({ embedding, qdrant, meili, rerank: null });

    await expect(indexMemory(memoryRow())).rejects.toThrow();
    expect(qdrant.upsertPoints).toHaveBeenCalled();
  });

  it('no-ops silently when no store is configured', async () => {
    const embedding = fakeEmbedding();
    setRetrievalClientsForTest({ embedding, qdrant: null, meili: null, rerank: null });

    await expect(indexMemory(memoryRow())).resolves.toBeUndefined();
    expect(embedding.embedTexts).not.toHaveBeenCalled();
  });
});

describe('removeMemoryIndex', () => {
  it('deletes the point and document from both stores', async () => {
    const qdrant = fakeQdrant();
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding: null, qdrant, meili, rerank: null });

    await removeMemoryIndex('mem-1');

    expect(qdrant.deletePoints).toHaveBeenCalledWith('agent_memory', ['mem-1']);
    expect(meili.deleteDocuments).toHaveBeenCalledWith('memories', ['mem-1']);
  });

  it('runs both deletes even when one fails, then throws', async () => {
    const qdrant = fakeQdrant();
    qdrant.deletePoints.mockRejectedValue(new Error('qdrant down'));
    const meili = fakeMeili();
    setRetrievalClientsForTest({ embedding: null, qdrant, meili, rerank: null });

    await expect(removeMemoryIndex('mem-1')).rejects.toThrow();
    expect(meili.deleteDocuments).toHaveBeenCalledWith('memories', ['mem-1']);
  });

  it('no-ops silently when nothing is configured', async () => {
    setRetrievalClientsForTest({ embedding: null, qdrant: null, meili: null, rerank: null });
    await expect(removeMemoryIndex('mem-1')).resolves.toBeUndefined();
  });
});

describe('searchMemories', () => {
  it('returns null when any retrieval client is not configured', async () => {
    setRetrievalClientsForTest({ embedding: null, qdrant: null, meili: null, rerank: null });
    await expect(
      searchMemories({ userId: 'u1', capability: 'cluster', query: '周报', limit: 5 }),
    ).resolves.toBeNull();

    // Partial configuration (vector only) is still not enough for the hybrid path.
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant: fakeQdrant(),
      meili: null,
      rerank: null,
    });
    await expect(
      searchMemories({ userId: 'u1', capability: 'cluster', query: '周报', limit: 5 }),
    ).resolves.toBeNull();
  });

  it('returns null for a blank query without calling the embedding API', async () => {
    const embedding = fakeEmbedding();
    setRetrievalClientsForTest({
      embedding,
      qdrant: fakeQdrant(),
      meili: fakeMeili(),
      rerank: fakeRerank(),
    });
    await expect(
      searchMemories({ userId: 'u1', capability: 'cluster', query: '   ', limit: 5 }),
    ).resolves.toBeNull();
    expect(embedding.embedTexts).not.toHaveBeenCalled();
  });

  it('hybrid recall: qdrant + meili with enforced user filters, RRF fusion, then rerank', async () => {
    const embedding = fakeEmbedding([[0.1, 0.2, 0.3]]);
    const qdrant = fakeQdrant();
    qdrant.queryPoints.mockResolvedValue([
      { id: 'm1', score: 0.9, payload: { kind: 'preference', content: '偏好记忆' } },
      { id: 'm2', score: 0.8, payload: { kind: 'pattern', content: '模式记忆' } },
    ]);
    const meili = fakeMeili([
      { id: 'm2', kind: 'pattern', content: '模式记忆' },
      { id: 'm3', kind: 'correction', content: '纠正记忆' },
    ]);
    const rerank = fakeRerank([
      { index: 2, score: 0.95 },
      { index: 0, score: 0.8 },
    ]);
    setRetrievalClientsForTest({ embedding, qdrant, meili, rerank });

    const result = await searchMemories({
      userId: 'u1',
      capability: 'cluster',
      query: '周报怎么写',
      limit: 2,
    });

    expect(embedding.embedTexts).toHaveBeenCalledWith(['周报怎么写'], { userId: 'u1' });
    // User isolation + scope match-any are enforced inside the pipeline.
    expect(qdrant.queryPoints).toHaveBeenCalledWith(
      'agent_memory',
      [0.1, 0.2, 0.3],
      {
        must: [
          { key: 'userId', match: { value: 'u1' } },
          { key: 'scope', match: { any: ['all', 'cluster'] } },
        ],
      },
      20,
    );
    expect(meili.search).toHaveBeenCalledWith('memories', {
      q: '周报怎么写',
      filter: "userId = 'u1' AND scope IN ['all', 'cluster']",
      limit: 20,
    });
    // RRF order: m2 (both lists) > m1 (vector #1) > m3 (sparse #2).
    expect(rerank.rerankTexts).toHaveBeenCalledWith(
      '周报怎么写',
      ['模式记忆', '偏好记忆', '纠正记忆'],
      2,
      { userId: 'u1' },
    );
    // Final order follows the rerank indices into the RRF-ordered candidates.
    expect(result).toEqual([
      { id: 'm3', kind: 'correction', content: '纠正记忆' },
      { id: 'm2', kind: 'pattern', content: '模式记忆' },
    ]);
  });

  it('scopes to all-memory only when no capability is given', async () => {
    const qdrant = fakeQdrant();
    qdrant.queryPoints.mockResolvedValue([
      { id: 'm1', score: 0.9, payload: { kind: 'preference', content: '偏好记忆' } },
    ]);
    const meili = fakeMeili([]);
    const rerank = fakeRerank([{ index: 0, score: 0.9 }]);
    setRetrievalClientsForTest({ embedding: fakeEmbedding(), qdrant, meili, rerank });

    const result = await searchMemories({ userId: 'u1', query: '周报', limit: 5 });

    expect(qdrant.queryPoints).toHaveBeenCalledWith(
      'agent_memory',
      expect.any(Array),
      {
        must: [
          { key: 'userId', match: { value: 'u1' } },
          { key: 'scope', match: { any: ['all'] } },
        ],
      },
      20,
    );
    expect(meili.search).toHaveBeenCalledWith('memories', {
      q: '周报',
      filter: "userId = 'u1' AND scope IN ['all']",
      limit: 20,
    });
    expect(result).toEqual([{ id: 'm1', kind: 'preference', content: '偏好记忆' }]);
  });

  it('returns an empty list when neither store recalls anything', async () => {
    setRetrievalClientsForTest({
      embedding: fakeEmbedding(),
      qdrant: fakeQdrant(),
      meili: fakeMeili(),
      rerank: fakeRerank(),
    });
    await expect(
      searchMemories({ userId: 'u1', capability: 'cluster', query: '周报', limit: 5 }),
    ).resolves.toEqual([]);
  });

  it('propagates embedding failures so callers can degrade', async () => {
    const embedding = fakeEmbedding();
    embedding.embedTexts.mockRejectedValue(new Error('dashscope down'));
    setRetrievalClientsForTest({
      embedding,
      qdrant: fakeQdrant(),
      meili: fakeMeili(),
      rerank: fakeRerank(),
    });
    await expect(
      searchMemories({ userId: 'u1', capability: 'cluster', query: '周报', limit: 5 }),
    ).rejects.toThrow('dashscope down');
  });
});

describe('index job tracking', () => {
  it('waitForIndexIdle blocks until tracked jobs settle', async () => {
    let settled = false;
    let release!: () => void;
    trackIndexJob(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const idle = waitForIndexIdle().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    await idle;
    expect(settled).toBe(true);
  });

  it('swallows tracked job rejections with a console error so waitForIndexIdle never throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    trackIndexJob(Promise.reject(new Error('boom')), 'test job');
    await expect(waitForIndexIdle()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('[retrieval]'),
      expect.any(Error),
    );
    errSpy.mockRestore();
  });
});
