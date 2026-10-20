/** Compare thread names after stripping dates, brackets, and separators. */
export function normalizeThreadName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/【[^】]*】/g, '')
    .replace(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g, '')
    .replace(/\d{1,2}[./-]\d{1,2}/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export interface ClusterTargetInput {
  name: string;
  /** Absent or undefined both mean the model did not name an existing thread. */
  outcomeId?: string | undefined;
}

export interface ExistingThread {
  id: string;
  name: string;
}

/**
 * Attach when the model names an open thread, or the proposed name is the
 * same thread with different spacing or a date stuffed into the title.
 */
export function resolveClusterTarget(
  thread: ClusterTargetInput,
  existing: readonly ExistingThread[],
): { kind: 'attach'; outcomeId: string } | { kind: 'create' } {
  if (thread.outcomeId !== undefined && existing.some((row) => row.id === thread.outcomeId)) {
    return { kind: 'attach', outcomeId: thread.outcomeId };
  }
  const key = normalizeThreadName(thread.name);
  if (key === '') return { kind: 'create' };
  const match = existing.find((row) => normalizeThreadName(row.name) === key);
  if (match) return { kind: 'attach', outcomeId: match.id };
  return { kind: 'create' };
}
