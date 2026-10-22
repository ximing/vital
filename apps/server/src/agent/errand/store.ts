import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { inboxItems, tasks, type TaskRow } from '../../db/schema.js';
import { ORGANIZE_MAX_IDS } from './model.js';

export async function ownedInbox(userId: string, inboxItemId: string) {
  const [row] = await getDb()
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.id, inboxItemId),
        eq(inboxItems.userId, userId),
        isNull(inboxItems.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function liveInboxIds(userId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)].slice(0, ORGANIZE_MAX_IDS);
  const rows = await getDb()
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        inArray(inboxItems.id, unique),
        isNull(inboxItems.deletedAt),
      ),
    );
  const live = new Set(rows.map((row) => row.id));
  return unique.filter((id) => live.has(id));
}

export async function taskById(userId: string, taskId: string): Promise<TaskRow | null> {
  const [row] = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);
  return row ?? null;
}
