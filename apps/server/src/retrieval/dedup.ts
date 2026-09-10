import { MEMORY_COLLECTION } from './pipeline.js';
import { getRetrievalClients } from './registry.js';

/** Cosine similarity in [−1, 1]; zero-norm vectors score 0. */
export function cosineSimilarity(a: number[], b: number[]): number {
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

/** Default similarity cutoff for flagging duplicate memories during distill. */
export const MEMORY_SIMILARITY_THRESHOLD = 0.85;

/**
 * All-pairs semantic duplicate detection over one user's memory vectors.
 * Returns null when Qdrant is not configured so callers can skip the hint;
 * infra errors are thrown for the caller to log and degrade. Each pair
 * appears once, ordered by similarity descending.
 */
export async function memorySimilarityPairs(
  userId: string,
  threshold = MEMORY_SIMILARITY_THRESHOLD,
): Promise<[string, string][] | null> {
  const { qdrant } = getRetrievalClients();
  if (!qdrant) return null;
  const points = await qdrant.scrollPoints(
    MEMORY_COLLECTION,
    { must: [{ key: 'userId', match: { value: userId } }] },
    { withVector: true },
  );
  const scored: { pair: [string, string]; score: number }[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const left = points[i];
    if (!left?.vector || left.vector.length === 0) continue;
    for (let j = i + 1; j < points.length; j += 1) {
      const right = points[j];
      if (!right?.vector || right.vector.length !== left.vector.length) continue;
      const score = cosineSimilarity(left.vector, right.vector);
      if (score >= threshold) scored.push({ pair: [String(left.id), String(right.id)], score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ pair }) => pair);
}
