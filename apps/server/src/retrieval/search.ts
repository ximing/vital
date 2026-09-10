import type { SearchResults } from '@vital/dto';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { inboxItems, outcomes, type InboxItemRow, type OutcomeRow } from '../db/schema.js';
import type { MeiliClient } from './meili.js';
import { getRetrievalClients } from './registry.js';
import { TASKS_INDEX } from './tasks.js';

/** Meili indexes for the global quick search (tasks index is owned by tasks.ts). */
export const OUTCOMES_INDEX = 'outcomes';
export const INBOX_INDEX = 'inbox';

/** Default per-group hit count for searchAll. */
const DEFAULT_GROUP_LIMIT = 5;
/** Page size when enumerating indexed ids for stale pruning. */
const MEILI_PAGE_SIZE = 1000;

function escapeMeili(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

type OutcomeIndexSource = Pick<OutcomeRow, 'id' | 'userId' | 'name' | 'status'>;
type InboxIndexSource = Pick<InboxItemRow, 'id' | 'userId' | 'title' | 'excerpt' | 'status'>;

function outcomeDoc(outcome: OutcomeIndexSource): Record<string, unknown> {
  return {
    id: outcome.id,
    userId: outcome.userId,
    type: 'outcome',
    name: outcome.name,
    status: outcome.status,
  };
}

function inboxDoc(item: InboxIndexSource): Record<string, unknown> {
  return {
    id: item.id,
    userId: item.userId,
    type: 'inbox',
    title: item.title,
    excerpt: item.excerpt,
    status: item.status,
  };
}

/**
 * Index settings (filterable userId …) must exist before filtered search works.
 * Upserts auto-create a bare index, so hooks stay thin and the read/sync paths
 * ensure settings once per client instance.
 */
const ensuredClients = new WeakSet<MeiliClient>();

async function ensureSearchIndexes(meili: MeiliClient): Promise<void> {
  if (ensuredClients.has(meili)) return;
  await Promise.all([
    meili.ensureIndex(TASKS_INDEX),
    meili.ensureIndex(OUTCOMES_INDEX),
    meili.ensureIndex(INBOX_INDEX),
  ]);
  ensuredClients.add(meili);
}

/** Index (or re-index) one outcome row. No-op when Meilisearch is not configured. */
export async function indexOutcome(outcome: OutcomeIndexSource): Promise<void> {
  const { meili } = getRetrievalClients();
  if (!meili) return;
  await meili.upsertDocuments(OUTCOMES_INDEX, [outcomeDoc(outcome)]);
}

/** Remove one outcome from the index. No-op when Meilisearch is not configured. */
export async function removeOutcomeIndex(outcomeId: string): Promise<void> {
  const { meili } = getRetrievalClients();
  if (!meili) return;
  await meili.deleteDocuments(OUTCOMES_INDEX, [outcomeId]);
}

/** Index (or re-index) one inbox row. No-op when Meilisearch is not configured. */
export async function indexInboxItem(item: InboxIndexSource): Promise<void> {
  const { meili } = getRetrievalClients();
  if (!meili) return;
  await meili.upsertDocuments(INBOX_INDEX, [inboxDoc(item)]);
}

/** Remove one inbox item from the index. No-op when Meilisearch is not configured. */
export async function removeInboxItemIndex(inboxItemId: string): Promise<void> {
  const { meili } = getRetrievalClients();
  if (!meili) return;
  await meili.deleteDocuments(INBOX_INDEX, [inboxItemId]);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function mapTaskHits(hits: Record<string, unknown>[]): SearchResults['tasks'] {
  const out: SearchResults['tasks'] = [];
  for (const hit of hits) {
    const id = asString(hit['id']);
    const title = asString(hit['title']);
    if (id === null || title === null) continue;
    out.push({ id, listId: asString(hit['listId']) ?? '', title, status: asString(hit['status']) ?? '' });
  }
  return out;
}

function mapOutcomeHits(hits: Record<string, unknown>[]): SearchResults['outcomes'] {
  const out: SearchResults['outcomes'] = [];
  for (const hit of hits) {
    const id = asString(hit['id']);
    const name = asString(hit['name']);
    if (id === null || name === null) continue;
    out.push({ id, name, status: asString(hit['status']) ?? '' });
  }
  return out;
}

function mapInboxHits(hits: Record<string, unknown>[]): SearchResults['inbox'] {
  const out: SearchResults['inbox'] = [];
  for (const hit of hits) {
    const id = asString(hit['id']);
    const title = asString(hit['title']);
    if (id === null || title === null) continue;
    out.push({ id, title, excerpt: asString(hit['excerpt']) });
  }
  return out;
}

/**
 * Global quick search: one multiSearch across tasks/outcomes/inbox, always
 * filtered to the calling user, grouped slim hits back. Returns null when
 * Meilisearch is not configured; infra errors propagate to the caller.
 */
export async function searchAll(input: {
  userId: string;
  q: string;
  limit?: number;
}): Promise<SearchResults | null> {
  const { meili } = getRetrievalClients();
  if (!meili) return null;
  await ensureSearchIndexes(meili);
  const limit = input.limit ?? DEFAULT_GROUP_LIMIT;
  const filter = `userId = '${escapeMeili(input.userId)}'`;
  const grouped = await meili.multiSearch([
    { indexUid: TASKS_INDEX, q: input.q, filter, limit },
    { indexUid: OUTCOMES_INDEX, q: input.q, filter, limit },
    { indexUid: INBOX_INDEX, q: input.q, filter, limit },
  ]);
  return {
    tasks: mapTaskHits(grouped[TASKS_INDEX] ?? []),
    outcomes: mapOutcomeHits(grouped[OUTCOMES_INDEX] ?? []),
    inbox: mapInboxHits(grouped[INBOX_INDEX] ?? []),
  };
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

/** Drop index documents whose ids no longer exist in PostgreSQL. */
async function pruneStale(
  meili: MeiliClient,
  uid: string,
  userId: string,
  aliveIds: Set<string>,
): Promise<number> {
  const indexed = await listIndexedIds(meili, uid, userId);
  const stale = indexed.filter((id) => !aliveIds.has(id));
  if (stale.length > 0) await meili.deleteDocuments(uid, stale);
  return stale.length;
}

export interface SearchIndexSyncStats {
  /** Outcome rows upserted from PG. */
  outcomes: number;
  /** Inbox rows (not soft-deleted) upserted from PG. */
  inbox: number;
  /** Stale ids pruned from the two indexes. */
  removed: number;
}

/**
 * Rebuild one user's outcomes/inbox indexes from PostgreSQL (the source of
 * truth): upsert every live row, then delete index ids PG no longer has.
 * Folded into the index.sync job; not scheduled on its own.
 *
 * Returns zero counts when Meilisearch is not configured. Infra errors
 * propagate so the caller can mark the job retryable.
 */
export async function syncSearchIndexes(userId: string): Promise<SearchIndexSyncStats> {
  const stats: SearchIndexSyncStats = { outcomes: 0, inbox: 0, removed: 0 };
  const { meili } = getRetrievalClients();
  if (!meili) return stats;
  await ensureSearchIndexes(meili);
  const [outcomeRows, inboxRows] = await Promise.all([
    getDb()
      .select({ id: outcomes.id, userId: outcomes.userId, name: outcomes.name, status: outcomes.status })
      .from(outcomes)
      .where(eq(outcomes.userId, userId)),
    getDb()
      .select({
        id: inboxItems.id,
        userId: inboxItems.userId,
        title: inboxItems.title,
        excerpt: inboxItems.excerpt,
        status: inboxItems.status,
      })
      .from(inboxItems)
      .where(and(eq(inboxItems.userId, userId), isNull(inboxItems.deletedAt))),
  ]);
  await meili.upsertDocuments(OUTCOMES_INDEX, outcomeRows.map(outcomeDoc));
  await meili.upsertDocuments(INBOX_INDEX, inboxRows.map(inboxDoc));
  stats.outcomes = outcomeRows.length;
  stats.inbox = inboxRows.length;
  stats.removed += await pruneStale(meili, OUTCOMES_INDEX, userId, new Set(outcomeRows.map((row) => row.id)));
  stats.removed += await pruneStale(meili, INBOX_INDEX, userId, new Set(inboxRows.map((row) => row.id)));
  return stats;
}
