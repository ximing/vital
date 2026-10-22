import { AppError } from '../../errors.js';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import { entityLinks, inboxItems, type TaskRow } from '../../db/schema.js';
import { liveInboxIds, taskById } from './store.js';
import { enqueueOrganize } from './organize.js';
import { enqueueRead } from './read.js';
import { type ErrandKind, type ErrandStart } from './model.js';

async function linkedInboxIds(userId: string, task: TaskRow): Promise<string[]> {
  const ids = new Set<string>();
  for (const match of task.notesMd.matchAll(/<!-- errand-source:inbox:([0-9a-fA-F-]{36}) -->/g)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  const converted = await getDb()
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        eq(inboxItems.convertedTaskId, task.id),
        isNull(inboxItems.deletedAt),
      ),
    );
  for (const row of converted) ids.add(row.id);
  const links = await getDb()
    .select({ toId: entityLinks.toId })
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, userId),
        eq(entityLinks.fromType, 'task'),
        eq(entityLinks.fromId, task.id),
        eq(entityLinks.toType, 'inbox'),
      ),
    );
  for (const row of links) ids.add(row.toId);
  return liveInboxIds(userId, [...ids]);
}

export async function upgradeTaskErrand(
  userId: string,
  taskId: string,
  input: { kind?: ErrandKind; inboxItemId?: string; inboxItemIds?: string[] } = {},
): Promise<ErrandStart> {
  const task = await taskById(userId, taskId);
  if (!task || task.deletedAt) throw AppError.of(404, 'NOT_FOUND');
  if (task.status === 'done' || task.status === 'canceled') {
    throw new AppError(400, 'VALIDATION_ERROR', '这个任务已经结束，不能再代办。');
  }
  if (!task.delegable) {
    throw new AppError(400, 'VALIDATION_ERROR', '先打开「可交给 Agent」，才能改为代办。');
  }
  if (input.kind === 'inbox.organize') {
    const ids = input.inboxItemIds ?? (await linkedInboxIds(userId, task));
    if (ids.length === 0)
      throw new AppError(400, 'VALIDATION_ERROR', '这个任务没有连着收集箱，还不能代办。');
    return enqueueOrganize(userId, ids, 'task.draft', task.id);
  }
  if (input.kind === 'inbox.read_summarize' || input.inboxItemId) {
    const inboxItemId = input.inboxItemId ?? (await linkedInboxIds(userId, task))[0];
    if (!inboxItemId)
      throw new AppError(400, 'VALIDATION_ERROR', '这个任务没有连着收集箱，还不能代办。');
    return enqueueRead(userId, inboxItemId, 'task.draft', task.id);
  }
  const linked = await linkedInboxIds(userId, task);
  const onlyId = linked[0];
  if (linked.length === 1 && onlyId !== undefined)
    return enqueueRead(userId, onlyId, 'task.draft', task.id);
  if (linked.length > 1) return enqueueOrganize(userId, linked, 'task.draft', task.id);
  throw new AppError(400, 'VALIDATION_ERROR', '这个任务没有连着收集箱，还不能代办。');
}
