import type { SimilarTaskHit } from '@vital/dto';
import { and, desc, eq, gte, inArray, isNull, ne } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tasks } from '../db/schema.js';
import { getRetrievalClients } from './registry.js';
import { searchSimilarTasks } from './tasks.js';

/** Titles shorter than this have no duplicate-detection value. */
export const DUPLICATE_QUERY_MIN_LENGTH = 4;
/** SQL complement for index lag: open tasks updated within this many days. */
export const DUPLICATE_SQL_WINDOW_DAYS = 14;
export const DUPLICATE_SQL_WINDOW_LIMIT = 50;
export const DUPLICATE_RESULT_LIMIT = 3;
/**
 * DashScope text-rerank `relevance_score` (0–1). Near-duplicate titles typically
 * score well above this; unrelated recent tasks in the SQL window score well below.
 * Tunable if false positives/negatives show up in use.
 */
export const DUPLICATE_RERANK_MIN_SCORE = 0.4;

const OPEN_STATUSES = ['todo', 'doing'] as const;

type Candidate = SimilarTaskHit & { text: string };

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function longestCommonSubstringLength(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  let best = 0;
  for (let i = 0; i < short.length; i += 1) {
    for (let j = i + DUPLICATE_QUERY_MIN_LENGTH; j <= short.length; j += 1) {
      if (long.includes(short.slice(i, j))) best = Math.max(best, j - i);
      else break;
    }
  }
  return best;
}

/** Lexical fallback when rerank is unavailable (SQL window still has to filter). */
export function lexicalDuplicateScore(query: string, title: string): number {
  const q = normalizeTitle(query);
  const t = normalizeTitle(title);
  if (q.length === 0 || t.length === 0) return 0;
  if (q === t) return 1;
  if (t.includes(q) || q.includes(t)) return 0.9;
  const lcs = longestCommonSubstringLength(q, t);
  if (lcs < DUPLICATE_QUERY_MIN_LENGTH) return 0;
  return lcs / Math.max(q.length, t.length);
}

async function loadRecentOpenTasks(
  userId: string,
  excludeId: string | undefined,
): Promise<SimilarTaskHit[]> {
  const since = new Date(Date.now() - DUPLICATE_SQL_WINDOW_DAYS * 24 * 3600 * 1000);
  const conds = [
    eq(tasks.userId, userId),
    isNull(tasks.deletedAt),
    inArray(tasks.status, [...OPEN_STATUSES]),
    gte(tasks.updatedAt, since),
  ];
  if (excludeId !== undefined) conds.push(ne(tasks.id, excludeId));
  return getDb()
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(and(...conds))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .limit(DUPLICATE_SQL_WINDOW_LIMIT);
}

function mergeCandidates(
  indexHits: SimilarTaskHit[],
  sqlHits: SimilarTaskHit[],
  excludeId: string | undefined,
): Candidate[] {
  const byId = new Map<string, Candidate>();
  for (const hit of sqlHits) {
    byId.set(hit.id, { id: hit.id, title: hit.title, text: hit.title });
  }
  for (const hit of indexHits) {
    if (!byId.has(hit.id)) byId.set(hit.id, { id: hit.id, title: hit.title, text: hit.title });
  }
  if (excludeId !== undefined) byId.delete(excludeId);
  return [...byId.values()];
}

function lexicalTop(query: string, candidates: Candidate[]): SimilarTaskHit[] {
  return candidates
    .map((candidate) => ({ candidate, score: lexicalDuplicateScore(query, candidate.title) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
    .slice(0, DUPLICATE_RESULT_LIMIT)
    .map(({ candidate }) => ({ id: candidate.id, title: candidate.title }));
}

/**
 * Best-effort open-task duplicate detection. Index recall (may lag) ∪ SQL
 * recent window (catches just-created rows), then one rerank of the merged
 * set. Never throws — missing clients or infra errors yield [].
 */
export async function findPotentialDuplicates(
  userId: string,
  query: string,
  excludeId?: string,
): Promise<SimilarTaskHit[]> {
  try {
    if (query.trim().length < DUPLICATE_QUERY_MIN_LENGTH) return [];

    let indexHits: SimilarTaskHit[] = [];
    try {
      const found = await searchSimilarTasks({
        userId,
        query,
        ...(excludeId !== undefined ? { excludeId } : {}),
        status: OPEN_STATUSES,
        limit: DUPLICATE_SQL_WINDOW_LIMIT,
      });
      if (found) indexHits = found;
    } catch (err) {
      console.error('[retrieval] findPotentialDuplicates searchSimilarTasks failed', err);
    }

    let sqlHits: SimilarTaskHit[] = [];
    try {
      sqlHits = await loadRecentOpenTasks(userId, excludeId);
    } catch (err) {
      console.error('[retrieval] findPotentialDuplicates SQL window failed', err);
    }

    const candidates = mergeCandidates(indexHits, sqlHits, excludeId);
    if (candidates.length === 0) return [];

    const { rerank } = getRetrievalClients();
    if (!rerank) return lexicalTop(query, candidates);

    try {
      const ranked = await rerank.rerankTexts(
        query,
        candidates.map((candidate) => candidate.text),
        candidates.length,
        { userId },
      );
      const hits: SimilarTaskHit[] = [];
      for (const result of ranked) {
        const candidate = candidates[result.index];
        if (!candidate) continue;
        if (result.score < DUPLICATE_RERANK_MIN_SCORE) continue;
        hits.push({ id: candidate.id, title: candidate.title });
        if (hits.length >= DUPLICATE_RESULT_LIMIT) break;
      }
      return hits;
    } catch (err) {
      console.error('[retrieval] findPotentialDuplicates rerank failed', err);
      return lexicalTop(query, candidates);
    }
  } catch (err) {
    console.error('[retrieval] findPotentialDuplicates failed', err);
    return [];
  }
}

/** Attach similarOpenTasks on a create DTO when detection found hits. */
export async function withSimilarOpenTasks<T extends { id: string; title: string }>(
  userId: string,
  task: T,
): Promise<T & { similarOpenTasks?: SimilarTaskHit[] }> {
  const similarOpenTasks = await findPotentialDuplicates(userId, task.title, task.id);
  if (similarOpenTasks.length === 0) return task;
  return { ...task, similarOpenTasks };
}
