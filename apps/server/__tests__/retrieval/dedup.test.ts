import { afterEach, describe, expect, it, vi } from 'vitest';
import { cosineSimilarity, memorySimilarityPairs } from '../../src/retrieval/dedup.js';
import {
  resetRetrievalClientsForTest,
  setRetrievalClientsForTest,
  type QdrantClient,
  type QdrantStoredPoint,
} from '../../src/retrieval/registry.js';

function fakeQdrant(points: QdrantStoredPoint[]) {
  return {
    ensureCollection: vi.fn<QdrantClient['ensureCollection']>(() => Promise.resolve()),
    upsertPoints: vi.fn<QdrantClient['upsertPoints']>(() => Promise.resolve()),
    queryPoints: vi.fn<QdrantClient['queryPoints']>(() => Promise.resolve([])),
    deletePoints: vi.fn<QdrantClient['deletePoints']>(() => Promise.resolve()),
    scrollPoints: vi.fn<QdrantClient['scrollPoints']>(() => Promise.resolve(points)),
  };
}

afterEach(() => {
  resetRetrievalClientsForTest();
});

describe('cosineSimilarity', () => {
  it('scores identical, orthogonal and zero-norm vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([0.6, 0.8], [0.6, 0.8])).toBeCloseTo(1);
  });
});

describe('memorySimilarityPairs', () => {
  it('returns null when the qdrant client is not configured', async () => {
    setRetrievalClientsForTest({ qdrant: null });
    await expect(memorySimilarityPairs('user-1')).resolves.toBeNull();
  });

  it('pairs memories at or above the default threshold, each pair once', async () => {
    const qdrant = fakeQdrant([
      { id: 'a', payload: {}, vector: [1, 0] },
      { id: 'b', payload: {}, vector: [0.999, 0.04] },
      { id: 'c', payload: {}, vector: [0, 1] },
    ]);
    setRetrievalClientsForTest({ qdrant });

    const pairs = await memorySimilarityPairs('user-1');
    expect(pairs).toEqual([['a', 'b']]);
    // userId filter is enforced inside, vectors requested explicitly.
    expect(qdrant.scrollPoints).toHaveBeenCalledWith(
      'agent_memory',
      { must: [{ key: 'userId', match: { value: 'user-1' } }] },
      { withVector: true },
    );
  });

  it('honors a custom threshold', async () => {
    setRetrievalClientsForTest({
      qdrant: fakeQdrant([
        { id: 'a', payload: {}, vector: [1, 0] },
        // cos([1,0],[0.999,0.04]) ≈ 0.9992
        { id: 'b', payload: {}, vector: [0.999, 0.04] },
      ]),
    });
    await expect(memorySimilarityPairs('user-1', 0.9995)).resolves.toEqual([]);
    await expect(memorySimilarityPairs('user-1', 0.999)).resolves.toEqual([['a', 'b']]);
  });

  it('returns pairs sorted by similarity, descending', async () => {
    setRetrievalClientsForTest({
      qdrant: fakeQdrant([
        { id: 'a', payload: {}, vector: [1, 0] },
        // cos(a,b) = 0.96, cos(a,d) = 0.9, cos(b,d) ≈ 0.986
        { id: 'b', payload: {}, vector: [0.96, 0.28] },
        { id: 'd', payload: {}, vector: [0.9, 0.4359] },
      ]),
    });
    const pairs = await memorySimilarityPairs('user-1');
    expect(pairs).toEqual([
      ['b', 'd'],
      ['a', 'b'],
      ['a', 'd'],
    ]);
  });

  it('skips points with missing vectors or mismatched dimensions', async () => {
    setRetrievalClientsForTest({
      qdrant: fakeQdrant([
        { id: 'a', payload: {}, vector: [1, 0] },
        { id: 'no-vector', payload: {} },
        { id: 'empty-vector', payload: {}, vector: [] },
        // cos would be 1 against [1,0] but the dimension differs: skipped.
        { id: 'three-dim', payload: {}, vector: [1, 0, 0] },
      ]),
    });
    await expect(memorySimilarityPairs('user-1')).resolves.toEqual([]);
  });

  it('propagates qdrant errors so callers can degrade', async () => {
    const qdrant = fakeQdrant([]);
    qdrant.scrollPoints.mockRejectedValue(new Error('qdrant down'));
    setRetrievalClientsForTest({ qdrant });
    await expect(memorySimilarityPairs('user-1')).rejects.toThrow('qdrant down');
  });
});
