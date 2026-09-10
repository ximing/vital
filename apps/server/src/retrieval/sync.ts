import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { agentMemory, tasks } from '../db/schema.js';
import { indexMemory, MEMORY_COLLECTION, MEMORY_INDEX } from './pipeline.js';
import { getRetrievalClients, type MeiliClient } from './registry.js';
import { indexTask, TASKS_COLLECTION, TASKS_INDEX } from './tasks.js';

export interface IndexSyncStats {
  /** Memory rows upserted from PG. */
  memories: number;
  /** Task rows (not soft-deleted) upserted from PG. */
  tasks: number;
  /** Stale ids pruned from the indexes across all stores. */
  removed: number;
}

const MEILI_PAGE_SIZE = 1000;

function escapeMeili(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Page through every document id belonging to the user in one Meili index. */
async function listIndexedIds(meili: MeiliClient, uid: string, userId: string): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += MEILI_PAGE_SIZE) {
    const page = await meili.listDocuments(uid, {
      filter: `userId = '${escapeMeili(userId)}'`,
      fields: ['id'],
      limit: MEILI_PAGE_SIZE,
      offset,
    });
    for (const doc of page.results) {
      if (typeof doc['id'] === 'string') ids.push(doc['id']);
    }
    if (page.results.length < MEILI_PAGE_SIZE) return ids;
  }
}

function userFilter(userId: string): Record<string, unknown> {
  return { must: [{ key: 'userId', match: { value: userId } }] };
}

function staleIds(indexed: Iterable<string>, alive: Set<string>): string[] {
  const stale: string[] = [];
  for (const id of indexed) {
    if (!alive.has(id)) stale.push(id);
  }
  return stale;
}

/**
 * Full-index healing for one user (the index.sync job). PostgreSQL is the
 * source of truth: every live row is re-upserted, and every indexed id that
 * no longer exists in PG is pruned. Collections/indexes are created here on
 * first sync — the fire-and-forget index hooks never ensure them.
 *
 * Returns zero counts when no store is configured. Infra errors propagate so
 * the caller can mark the job retryable instead of silently passing.
 */
export async function syncUserIndexes(userId: string): Promise<IndexSyncStats> {
  const { qdrant, meili } = getRetrievalClients();
  const stats: IndexSyncStats = { memories: 0, tasks: 0, removed: 0 };
  if (!qdrant && !meili) return stats;

  if (qdrant) {
    await qdrant.ensureCollection(MEMORY_COLLECTION);
    await qdrant.ensureCollection(TASKS_COLLECTION);
  }
  if (meili) {
    await meili.ensureIndex(MEMORY_INDEX);
    await meili.ensureIndex(TASKS_INDEX);
  }

  const db = getDb();
  const memoryRows = await db.select().from(agentMemory).where(eq(agentMemory.userId, userId));
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt)));

  // Re-upsert is idempotent; a partial failure aborts the sync so the job
  // retries rather than leaving a half-healed index looking done.
  for (const row of memoryRows) {
    await indexMemory(row);
    stats.memories += 1;
  }
  for (const row of taskRows) {
    await indexTask(row);
    stats.tasks += 1;
  }

  const aliveMemories = new Set(memoryRows.map((row) => row.id));
  const aliveTasks = new Set(taskRows.map((row) => row.id));

  if (qdrant) {
    const memoryPoints = await qdrant.scrollPoints(MEMORY_COLLECTION, userFilter(userId));
    const staleMemories = staleIds(
      memoryPoints.map((point) => String(point.id)),
      aliveMemories,
    );
    if (staleMemories.length > 0) {
      await qdrant.deletePoints(MEMORY_COLLECTION, staleMemories);
      stats.removed += staleMemories.length;
    }
    const taskPoints = await qdrant.scrollPoints(TASKS_COLLECTION, userFilter(userId));
    const staleTasks = staleIds(
      taskPoints.map((point) => String(point.id)),
      aliveTasks,
    );
    if (staleTasks.length > 0) {
      await qdrant.deletePoints(TASKS_COLLECTION, staleTasks);
      stats.removed += staleTasks.length;
    }
  }

  if (meili) {
    const memoryDocs = await listIndexedIds(meili, MEMORY_INDEX, userId);
    const staleMemories = staleIds(memoryDocs, aliveMemories);
    if (staleMemories.length > 0) {
      await meili.deleteDocuments(MEMORY_INDEX, staleMemories);
      stats.removed += staleMemories.length;
    }
    const taskDocs = await listIndexedIds(meili, TASKS_INDEX, userId);
    const staleTasks = staleIds(taskDocs, aliveTasks);
    if (staleTasks.length > 0) {
      await meili.deleteDocuments(TASKS_INDEX, staleTasks);
      stats.removed += staleTasks.length;
    }
  }

  return stats;
}
