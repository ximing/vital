import type { AgentMemoryRow } from '../db/schema.js';
import { getRetrievalClients } from './registry.js';
import { rrfMerge } from './rrf.js';

/** Qdrant collection / Meili index holding derived memory indexes. */
export const MEMORY_COLLECTION = 'agent_memory';
export const MEMORY_INDEX = 'memories';

/** Per-store recall size before RRF fusion; fused list is also capped at this. */
const RECALL_LIMIT = 20;

/* --------------------------------------------------------------------------
 * Fire-and-forget index job tracking. Business code indexes after commit and
 * never awaits; tests call waitForIndexIdle() to observe completion.
 * ------------------------------------------------------------------------ */

const pendingIndexJobs = new Set<Promise<unknown>>();

/**
 * Track a background index job. Rejections are logged with a [retrieval]
 * prefix and swallowed — indexing is best-effort, index.sync heals drift.
 */
export function trackIndexJob(job: Promise<unknown>, label = 'index job'): void {
  const tracked: Promise<void> = job.then(
    () => undefined,
    (err: unknown) => {
      console.error(`[retrieval] ${label} failed`, err);
    },
  );
  pendingIndexJobs.add(tracked);
  void tracked.finally(() => {
    pendingIndexJobs.delete(tracked);
  });
}

/** Test seam: resolves once every tracked index job (including cascades) settles. */
export async function waitForIndexIdle(): Promise<void> {
  while (pendingIndexJobs.size > 0) {
    await Promise.all([...pendingIndexJobs]);
  }
}

/* --------------------------------------------------------------------------
 * Memory indexing. PostgreSQL is the source of truth; both stores are written
 * independently so one failure cannot block the other — failures are
 * aggregated and thrown for the fire-and-forget hook to log.
 * ------------------------------------------------------------------------ */

/** Index (or re-index) one memory row. No-op when no store is configured. */
export async function indexMemory(row: AgentMemoryRow): Promise<void> {
  const clients = getRetrievalClients();
  const errors: unknown[] = [];
  if (clients.embedding && clients.qdrant) {
    try {
      const vectors = await clients.embedding.embedTexts([row.content], { userId: row.userId });
      const vector = vectors[0];
      if (!vector || vector.length === 0) {
        throw new Error('embedding returned no vector for memory content');
      }
      await clients.qdrant.upsertPoints(MEMORY_COLLECTION, [
        {
          id: row.id,
          vector,
          payload: {
            userId: row.userId,
            scope: row.scope,
            kind: row.kind,
            manual: row.manual,
            content: row.content,
          },
        },
      ]);
    } catch (err) {
      errors.push(err);
    }
  }
  if (clients.meili) {
    try {
      await clients.meili.upsertDocuments(MEMORY_INDEX, [
        {
          id: row.id,
          userId: row.userId,
          content: row.content,
          kind: row.kind,
          manual: row.manual,
          scope: row.scope,
        },
      ]);
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'indexMemory failed');
}

/** Remove one memory from both indexes. No-op when no store is configured. */
export async function removeMemoryIndex(memoryId: string): Promise<void> {
  const clients = getRetrievalClients();
  const errors: unknown[] = [];
  if (clients.qdrant) {
    try {
      await clients.qdrant.deletePoints(MEMORY_COLLECTION, [memoryId]);
    } catch (err) {
      errors.push(err);
    }
  }
  if (clients.meili) {
    try {
      await clients.meili.deleteDocuments(MEMORY_INDEX, [memoryId]);
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'removeMemoryIndex failed');
}

/* --------------------------------------------------------------------------
 * Hybrid memory search: vector recall (Qdrant) ∪ sparse recall (Meili),
 * fused with RRF, then reranked. userId/scope filters are enforced here so
 * callers cannot forget them.
 * ------------------------------------------------------------------------ */

export interface MemorySearchParams {
  userId: string;
  /** Capability whose memories may be recalled ('all' rows always match). */
  capability?: string;
  query: string;
  limit: number;
}

export interface MemorySearchHit {
  id: string;
  kind: string;
  content: string;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Returns null when hybrid retrieval is unavailable (missing clients, blank
 * query) so callers can fall back to the PG path. Throws on infra errors —
 * callers must catch and degrade.
 */
export async function searchMemories(
  params: MemorySearchParams,
): Promise<MemorySearchHit[] | null> {
  const { embedding, qdrant, meili, rerank } = getRetrievalClients();
  if (!embedding || !qdrant || !meili || !rerank) return null;
  const query = params.query.trim();
  if (query === '') return null;
  const vectors = await embedding.embedTexts([query], { userId: params.userId });
  const vector = vectors[0];
  if (!vector || vector.length === 0) return null;

  const scopes = params.capability !== undefined ? ['all', params.capability] : ['all'];
  const scopeList = scopes.map((scope) => `'${scope}'`).join(', ');
  const [scored, hits] = await Promise.all([
    qdrant.queryPoints(
      MEMORY_COLLECTION,
      vector,
      {
        must: [
          { key: 'userId', match: { value: params.userId } },
          { key: 'scope', match: { any: scopes } },
        ],
      },
      RECALL_LIMIT,
    ),
    meili.search(MEMORY_INDEX, {
      q: query,
      filter: `userId = '${params.userId}' AND scope IN [${scopeList}]`,
      limit: RECALL_LIMIT,
    }),
  ]);

  const merged = rrfMerge(
    [scored.map((point) => String(point.id)), hits.map((hit) => String(hit.id))],
  ).slice(0, RECALL_LIMIT);
  if (merged.length === 0) return [];

  const byId = new Map<string, MemorySearchHit>();
  const collect = (id: string, source: Record<string, unknown>): void => {
    if (byId.has(id)) return;
    const content = asString(source.content);
    const kind = asString(source.kind);
    if (content === null || kind === null) return;
    byId.set(id, { id, kind, content });
  };
  for (const point of scored) collect(String(point.id), point.payload);
  for (const hit of hits) collect(String(hit.id), hit);

  const candidates = merged
    .map((id) => byId.get(id))
    .filter((hit): hit is MemorySearchHit => hit !== undefined);
  if (candidates.length === 0) return [];

  const ranked = await rerank.rerankTexts(
    query,
    candidates.map((hit) => hit.content),
    params.limit,
    { userId: params.userId },
  );
  const results: MemorySearchHit[] = [];
  for (const { index } of ranked) {
    const hit = candidates[index];
    if (hit) results.push(hit);
  }
  return results;
}
