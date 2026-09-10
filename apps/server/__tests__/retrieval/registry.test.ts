import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config.js';
import {
  getRetrievalClients,
  resetRetrievalClientsForTest,
  retrievalConfigured,
  retrievalNamePrefix,
  searchConfigured,
  setRetrievalClientsForTest,
} from '../../src/retrieval/registry.js';
import type { EmbeddingClient, QdrantClient } from '../../src/retrieval/registry.js';

// The ambient env may or may not carry DASHSCOPE/QDRANT/MEILI variables, so
// expectations are derived from the parsed config instead of hard-coded.
describe('retrieval registry', () => {
  afterEach(() => {
    resetRetrievalClientsForTest();
  });

  it('configured flags reflect config completeness', () => {
    expect(retrievalConfigured()).toBe(Boolean(config.DASHSCOPE_API_KEY && config.QDRANT_URL));
    expect(searchConfigured()).toBe(Boolean(config.MEILI_URL && config.MEILI_ADMIN_KEY));
  });

  it('defaults the test namespace prefix to test_', () => {
    expect(config.NODE_ENV).toBe('test');
    expect(retrievalNamePrefix()).toBe('test_');
  });

  it('nulls out clients whose config is missing instead of throwing', () => {
    const clients = getRetrievalClients();
    expect(clients.embedding === null).toBe(!config.DASHSCOPE_API_KEY);
    expect(clients.rerank === null).toBe(!config.DASHSCOPE_API_KEY);
    expect(clients.qdrant === null).toBe(!config.QDRANT_URL);
    expect(clients.meili === null).toBe(!(config.MEILI_URL && config.MEILI_ADMIN_KEY));
  });

  it('serves injected fakes after setRetrievalClientsForTest', () => {
    const before = getRetrievalClients();
    const fakeEmbedding: EmbeddingClient = {
      embedTexts: vi.fn<EmbeddingClient['embedTexts']>().mockResolvedValue([[1, 2, 3]]),
    };
    const fakeQdrant = {
      ensureCollection: vi.fn(),
      upsertPoints: vi.fn(),
      queryPoints: vi.fn(),
      deletePoints: vi.fn(),
      scrollPoints: vi.fn(),
    } as unknown as QdrantClient;
    setRetrievalClientsForTest({ embedding: fakeEmbedding, qdrant: fakeQdrant });
    const clients = getRetrievalClients();
    expect(clients.embedding).toBe(fakeEmbedding);
    expect(clients.qdrant).toBe(fakeQdrant);
    // Untouched slots keep their real implementations.
    expect(clients.rerank).toBe(before.rerank);
    expect(clients.meili).toBe(before.meili);
  });

  it('resetRetrievalClientsForTest restores real implementations', () => {
    const fakeEmbedding: EmbeddingClient = {
      embedTexts: vi.fn<EmbeddingClient['embedTexts']>().mockResolvedValue([]),
    };
    setRetrievalClientsForTest({ embedding: fakeEmbedding });
    expect(getRetrievalClients().embedding).toBe(fakeEmbedding);
    resetRetrievalClientsForTest();
    const restored = getRetrievalClients().embedding;
    expect(restored).not.toBe(fakeEmbedding);
    expect(restored === null).toBe(!config.DASHSCOPE_API_KEY);
  });
});
