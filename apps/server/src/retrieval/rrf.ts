/**
 * Reciprocal Rank Fusion: merge multiple ranked id lists into one ranking.
 * score(id) = Σ over lists of 1 / (k + rank), rank 1-based; k defaults to 60.
 * Ties keep first-seen order (Map insertion order + stable sort).
 */
export function rrfMerge(lists: string[][], k = 60): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
