/** Fail the test when a query row is missing, without a non-null assertion. */
export function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}
