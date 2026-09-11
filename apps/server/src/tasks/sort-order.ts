import { and, eq, isNull, max } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tasks } from '../db/schema.js';
import { SORT_GAP } from '../lists/lists.service.js';

/**
 * Next free sort position among a parent's children (or a list's roots).
 * Pass a transaction to keep the ordering inside an outer tx
 * (e.g. decompose materialization).
 */
export async function nextSortOrder(
  listId: string,
  parentId: string | null,
  db: Pick<ReturnType<typeof getDb>, 'select'> = getDb(),
): Promise<number> {
  const cond =
    parentId === null
      ? and(eq(tasks.listId, listId), isNull(tasks.parentId))
      : and(eq(tasks.listId, listId), eq(tasks.parentId, parentId));
  const [agg] = await db.select({ m: max(tasks.sortOrder) }).from(tasks).where(cond);
  return (agg?.m ?? 0) + SORT_GAP;
}
