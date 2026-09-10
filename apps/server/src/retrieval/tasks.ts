import type { TaskRow } from '../db/schema.js';
import { RetrievalError } from './http.js';
import { getRetrievalClients } from './registry.js';
import { rrfMerge } from './rrf.js';

export const TASKS_COLLECTION = 'tasks';
export const TASKS_INDEX = 'tasks';

/** Notes are truncated together with the title into a 500-char index text. */
const INDEX_TEXT_LIMIT = 500;
const RECALL_LIMIT = 20;
/** Cosine threshold for greedy vector pre-grouping (outcome.cluster hint). */
export const CLUSTER_SIMILARITY_THRESHOLD = 0.8;

/** Markdown → plain text, best-effort; the result is embedding/search fodder only. */
export function notesToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function indexTextOf(task: TaskRow): string {
  const plain = notesToPlainText(task.notesMd);
  const text = plain === '' ? task.title : `${task.title}\n${plain}`;
  return text.slice(0, INDEX_TEXT_LIMIT);
}

/** Run both index sides independently; one failure never blocks the other. */
async function runBothSides(jobs: {
  qdrant?: (() => Promise<void>) | undefined;
  meili?: (() => Promise<void>) | undefined;
}): Promise<void> {
  const errors: unknown[] = [];
  await Promise.all(
    [jobs.qdrant, jobs.meili]
      .filter((job): job is () => Promise<void> => job !== undefined)
      .map(async (job) => {
        try {
          await job();
        } catch (err) {
          errors.push(err);
        }
      }),
  );
  if (errors.length > 0) {
    throw new AggregateError(errors, 'task index write partially failed');
  }
}

/** Index one task into Qdrant (vector) + Meilisearch (full text). */
export async function indexTask(task: TaskRow): Promise<void> {
  const { embedding, qdrant, meili } = getRetrievalClients();
  const content = indexTextOf(task);
  const notes = notesToPlainText(task.notesMd).slice(0, INDEX_TEXT_LIMIT);
  await runBothSides({
    qdrant:
      embedding && qdrant
        ? async () => {
            const [vector] = await embedding.embedTexts([content], {
              userId: task.userId,
            });
            if (!vector) {
              throw new RetrievalError('BAD_RESPONSE', 'embedding returned no vector for task');
            }
            await qdrant.upsertPoints(TASKS_COLLECTION, [
              {
                id: task.id,
                vector,
                payload: {
                  userId: task.userId,
                  status: task.status,
                  outcomeId: task.outcomeId,
                  parentId: task.parentId,
                  title: task.title,
                  content,
                },
              },
            ]);
          }
        : undefined,
    meili: meili
      ? async () => {
          await meili.upsertDocuments(TASKS_INDEX, [
            {
              id: task.id,
              userId: task.userId,
              type: 'task',
              title: task.title,
              notes,
              status: task.status,
              listId: task.listId,
            },
          ]);
        }
      : undefined,
  });
}

/** Remove one task from both indexes. */
export async function removeTaskIndex(taskId: string): Promise<void> {
  const { qdrant, meili } = getRetrievalClients();
  await runBothSides({
    qdrant: qdrant
      ? async () => {
          await qdrant.deletePoints(TASKS_COLLECTION, [taskId]);
        }
      : undefined,
    meili: meili
      ? async () => {
          await meili.deleteDocuments(TASKS_INDEX, [taskId]);
        }
      : undefined,
  });
}

export interface SimilarTaskHit {
  id: string;
  title: string;
}

function escapeMeili(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Hybrid similar-task search: Qdrant vector recall ∪ Meili sparse recall →
 * RRF fusion (top 20) → rerank → exclude the task itself → top `limit`.
 * Returns null when the retrieval clients are not configured; infra errors
 * propagate to the caller (processors catch and degrade).
 */
export async function searchSimilarTasks(input: {
  userId: string;
  query: string;
  excludeId?: string;
  status?: string;
  limit: number;
}): Promise<SimilarTaskHit[] | null> {
  const { embedding, qdrant, rerank, meili } = getRetrievalClients();
  if (!embedding || !qdrant || !rerank) return null;

  const [vector] = await embedding.embedTexts([input.query], { userId: input.userId });
  if (!vector) throw new RetrievalError('BAD_RESPONSE', 'embedding returned no vector for query');

  const must: unknown[] = [{ key: 'userId', match: { value: input.userId } }];
  if (input.status !== undefined) must.push({ key: 'status', match: { value: input.status } });
  const filter: Record<string, unknown> = { must };
  if (input.excludeId !== undefined) {
    filter['must_not'] = [{ has_id: [input.excludeId] }];
  }

  const textById = new Map<string, { title: string; text: string }>();
  const rankings: string[][] = [];

  const vectorHits = await qdrant.queryPoints(TASKS_COLLECTION, vector, filter, RECALL_LIMIT);
  rankings.push(vectorHits.map((hit) => String(hit.id)));
  for (const hit of vectorHits) {
    const title = typeof hit.payload['title'] === 'string' ? hit.payload['title'] : '';
    const content =
      typeof hit.payload['content'] === 'string' ? hit.payload['content'] : title;
    textById.set(String(hit.id), { title, text: content });
  }

  if (meili) {
    let meiliFilter = `userId = '${escapeMeili(input.userId)}'`;
    if (input.status !== undefined) {
      meiliFilter += ` AND status = '${escapeMeili(input.status)}'`;
    }
    const sparseHits = await meili.search(TASKS_INDEX, {
      q: input.query,
      filter: meiliFilter,
      limit: RECALL_LIMIT,
    });
    const sparseIds: string[] = [];
    for (const hit of sparseHits) {
      const id = typeof hit['id'] === 'string' ? hit['id'] : null;
      if (id === null) continue;
      sparseIds.push(id);
      if (textById.has(id)) continue;
      const title = typeof hit['title'] === 'string' ? hit['title'] : '';
      const notes = typeof hit['notes'] === 'string' ? hit['notes'] : '';
      textById.set(id, { title, text: notes === '' ? title : `${title}\n${notes}` });
    }
    rankings.push(sparseIds);
  }

  const fused = rrfMerge(rankings).slice(0, RECALL_LIMIT);
  const candidates = fused.flatMap((id) => {
    const entry = textById.get(id);
    return entry ? [{ id, ...entry }] : [];
  });
  if (candidates.length === 0) return [];

  const ranked = await rerank.rerankTexts(
    input.query,
    candidates.map((c) => c.text),
    candidates.length,
    { userId: input.userId },
  );
  const hits: SimilarTaskHit[] = [];
  for (const result of ranked) {
    const candidate = candidates[result.index];
    if (!candidate) continue;
    if (input.excludeId !== undefined && candidate.id === input.excludeId) continue;
    hits.push({ id: candidate.id, title: candidate.title });
    if (hits.length >= input.limit) break;
  }
  return hits;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) break;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Greedy vector pre-grouping: walk items in order, join the first group whose
 * representative (founding member) is within the cosine threshold, else found a
 * new group. Singleton groups are kept.
 */
export function groupTasksBySimilarity(
  items: { id: string; vector: number[] }[],
  threshold = CLUSTER_SIMILARITY_THRESHOLD,
): string[][] {
  const groups: { representative: number[]; ids: string[] }[] = [];
  for (const item of items) {
    let placed = false;
    for (const group of groups) {
      if (cosineSimilarity(group.representative, item.vector) >= threshold) {
        group.ids.push(item.id);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ representative: item.vector, ids: [item.id] });
  }
  return groups.map((group) => group.ids);
}

// ---------------------------------------------------------------------------
// Fire-and-forget tracking: index hooks never block business code, but tests
// (and graceful shutdown) need a way to drain in-flight index writes.

const inFlight = new Set<Promise<unknown>>();

/** Track a fire-and-forget index job so tests can await quiescence. */
export function trackTaskIndexJob(job: Promise<unknown>): void {
  inFlight.add(job);
  void job
    .catch(() => undefined)
    .then(() => {
      inFlight.delete(job);
    });
}

/** Resolve once every tracked index job has settled. Test seam. */
export async function waitForTaskIndexIdle(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}
