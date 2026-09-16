import type { Task } from '@vital/dto';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { taskTags, type TaskRow } from '../db/schema.js';
import { indexTask, removeTaskIndex, trackTaskIndexJob } from '../retrieval/tasks.js';
import type { RecurrenceTask } from './recurrence.js';
import { toTaskDto } from './task-dto.js';

export function toRecurrence(row: TaskRow): RecurrenceTask {
  return {
    id: row.id,
    listId: row.listId,
    title: row.title,
    timezone: row.timezone,
    isAllDay: row.isAllDay,
    dueAt: row.dueAt,
    startAt: row.startAt,
    recurrenceRrule: row.recurrenceRrule,
    recurrenceDtstart: row.recurrenceDtstart,
    status: row.status,
    priority: row.priority,
    pinned: row.pinned,
  };
}

export async function tagIdsByTask(taskIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const id of taskIds) map.set(id, []);
  if (taskIds.length === 0) return map;
  const rows = await getDb().select().from(taskTags).where(inArray(taskTags.taskId, taskIds));
  for (const row of rows) {
    const current = map.get(row.taskId);
    if (current) current.push(row.tagId);
    else map.set(row.taskId, [row.tagId]);
  }
  return map;
}

export async function dtoOf(row: TaskRow): Promise<Task> {
  const tags = await tagIdsByTask([row.id]);
  return toTaskDto(row, tags.get(row.id) ?? []);
}

/**
 * Fire-and-forget retrieval indexing. PG stays the source of truth; index
 * failures are logged, never thrown, and drift is healed by index.sync.
 */
export function fireIndexTask(row: TaskRow): void {
  trackTaskIndexJob(
    indexTask(row).catch((err: unknown) => {
      console.error('[retrieval] indexTask failed', err);
    }),
  );
}

export function fireRemoveTaskIndex(taskId: string): void {
  trackTaskIndexJob(
    removeTaskIndex(taskId).catch((err: unknown) => {
      console.error('[retrieval] removeTaskIndex failed', err);
    }),
  );
}

export async function replaceTags(
  taskId: string,
  tagIds: string[],
  db: Pick<ReturnType<typeof getDb>, 'delete' | 'insert'> = getDb(),
): Promise<void> {
  await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;
  await db.insert(taskTags).values(unique.map((tagId) => ({ taskId, tagId })));
}
