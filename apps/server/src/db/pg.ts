/** Walk DrizzleQueryError.cause (and nested) — pg `code` is not on the wrapper. */
export function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && current.code === '23505') return true;
    if (!('cause' in current)) break;
    current = current.cause;
  }
  return false;
}
