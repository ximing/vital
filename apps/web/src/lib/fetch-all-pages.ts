/** One cursor-paginated collection, capped so a stuck cursor cannot loop forever. */
export async function fetchAllPages<T>(
  loadPage: (cursor: string | undefined) => Promise<{
    items: readonly T[];
    nextCursor: string | null;
  }>,
  maxPages = 20,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i += 1) {
    const page = await loadPage(cursor);
    items.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return items;
}
