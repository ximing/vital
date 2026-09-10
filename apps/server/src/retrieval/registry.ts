import { config } from '../config.js';
import { createEmbeddingClient } from './embedding.js';
import type { EmbeddingClient } from './embedding.js';
import { createRerankClient } from './rerank.js';
import type { RerankClient } from './rerank.js';
import { createQdrantClient } from './qdrant.js';
import type { QdrantClient } from './qdrant.js';
import { createMeiliClient } from './meili.js';
import type { MeiliClient } from './meili.js';

export type { EmbeddingClient } from './embedding.js';
export type { RerankClient, RerankResult } from './rerank.js';
export type {
  QdrantClient,
  QdrantPoint,
  QdrantScoredPoint,
  QdrantStoredPoint,
} from './qdrant.js';
export type { MeiliClient, MeiliFilter, MeiliSearchQuery } from './meili.js';

export interface RetrievalClients {
  embedding: EmbeddingClient | null;
  rerank: RerankClient | null;
  qdrant: QdrantClient | null;
  meili: MeiliClient | null;
}

/** Vector retrieval (memory/tasks semantic search) needs dashscope + Qdrant. */
export function retrievalConfigured(): boolean {
  return Boolean(config.DASHSCOPE_API_KEY && config.QDRANT_URL);
}

/** Full-text search (Meilisearch) is independently optional. */
export function searchConfigured(): boolean {
  return Boolean(config.MEILI_URL && config.MEILI_ADMIN_KEY);
}

const DEFAULT_RETRIEVAL_NAMESPACE = {
  development: 'dev',
  production: 'prod',
  test: 'test',
} as const;

/** `dev_` / `prod_` prefix so a shared Qdrant/Meili cluster cannot mix environments. */
export function retrievalNamePrefix(): string {
  const namespace = config.RETRIEVAL_NAMESPACE ?? DEFAULT_RETRIEVAL_NAMESPACE[config.NODE_ENV];
  return `${namespace}_`;
}

function buildClients(): RetrievalClients {
  const dashscopeKey = config.DASHSCOPE_API_KEY;
  const meiliReady = config.MEILI_URL !== undefined && config.MEILI_ADMIN_KEY !== undefined;
  const namePrefix = retrievalNamePrefix();
  return {
    embedding: dashscopeKey
      ? createEmbeddingClient({
          apiKey: dashscopeKey,
          baseUrl: config.DASHSCOPE_BASE_URL,
          model: config.EMBEDDING_MODEL,
          dimensions: config.EMBEDDING_DIMENSIONS,
        })
      : null,
    rerank: dashscopeKey
      ? createRerankClient({
          apiKey: dashscopeKey,
          baseUrl: config.DASHSCOPE_BASE_URL,
          model: config.RERANK_MODEL,
        })
      : null,
    qdrant: config.QDRANT_URL
      ? createQdrantClient({
          url: config.QDRANT_URL,
          apiKey: config.QDRANT_API_KEY,
          vectorSize: config.EMBEDDING_DIMENSIONS,
          namePrefix,
        })
      : null,
    meili:
      meiliReady && config.MEILI_URL !== undefined && config.MEILI_ADMIN_KEY !== undefined
        ? createMeiliClient({
            url: config.MEILI_URL,
            apiKey: config.MEILI_ADMIN_KEY,
            namePrefix,
          })
        : null,
  };
}

let cached: RetrievalClients | null = null;
let testOverride: Partial<RetrievalClients> | null = null;

/**
 * Lazy singletons built from config. Missing config yields null slots —
 * callers must null-check and degrade, never throw.
 */
export function getRetrievalClients(): RetrievalClients {
  cached ??= buildClients();
  return testOverride ? { ...cached, ...testOverride } : cached;
}

/** Test seam. Do not call from product code. */
export function setRetrievalClientsForTest(clients: Partial<RetrievalClients>): void {
  testOverride = clients;
}

/** Test seam. Do not call from product code. */
export function resetRetrievalClientsForTest(): void {
  testOverride = null;
  cached = null;
}
