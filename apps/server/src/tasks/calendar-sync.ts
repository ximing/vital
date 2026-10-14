import { randomUUID } from 'node:crypto';
import {
  planDeviceCalendarSync,
  type DeviceCalendarSyncInput,
  type DeviceCalendarSyncResult,
} from '@vital/dto';
import { and, eq, isNotNull } from 'drizzle-orm';
import { getUserEntity } from '../auth/auth.service.js';
import { getDb } from '../db/index.js';
import { tasks, type NewTask, type TaskRow } from '../db/schema.js';
import { getInboxList, SORT_GAP } from '../lists/lists.service.js';
import { syncTaskNotifications } from '../notifications/outbox.js';
import { publishInvalidation } from '../sync/sync.hub.js';
import { nextSortOrder } from './sort-order.js';
import { fireIndexTask, fireRemoveTaskIndex } from './tasks.shared.js';

function notifyOf(row: TaskRow, deletedAt: Date | null) {
  return {
    id: row.id,
    userId: row.userId,
    listId: row.listId,
    title: row.title,
    status: row.status,
    dueAt: row.dueAt,
    reminderMode: row.reminderMode,
    reminderOffsetMinutes: row.reminderOffsetMinutes,
    reminderAt: row.reminderAt,
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    deletedAt,
    habitId: row.habitId,
    habitSeq: row.habitSeq,
    habitKey: row.habitKey,
    createdAt: row.createdAt,
  };
}

/**
 * Mirror one device calendar into inbox tasks.
 * The calendar wins for title and time. Status, notes, and list stay as the user left them.
 * Deleting the task in Vital keeps the key so the same event is not added again.
 */
export async function syncDeviceCalendar(
  userId: string,
  input: DeviceCalendarSyncInput,
  now = new Date(),
): Promise<DeviceCalendarSyncResult> {
  const user = await getUserEntity(userId);
  const inbox = await getInboxList(userId);
  const existing = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNotNull(tasks.calendarKey)));
  const plan = planDeviceCalendarSync(
    input,
    existing.flatMap((row) =>
      row.calendarKey === null
        ? []
        : [
            {
              id: row.id,
              calendarKey: row.calendarKey,
              title: row.title,
              startAt: row.startAt?.toISOString() ?? null,
              dueAt: row.dueAt?.toISOString() ?? null,
              isAllDay: row.isAllDay,
              status: row.status,
              deletedAt: row.deletedAt?.toISOString() ?? null,
            },
          ],
    ),
  );
  const byId = new Map(existing.map((row) => [row.id, row]));
  const touched: TaskRow[] = [];
  const removed: string[] = [];

  await getDb().transaction(async (tx) => {
    let sortOrder = await nextSortOrder(inbox.id, null, tx);
    for (const event of plan.create) {
      const when = new Date(event.start);
      const row: NewTask = {
        id: randomUUID(),
        userId,
        listId: inbox.id,
        parentId: null,
        outcomeId: null,
        estimateMinutes: null,
        title: event.title,
        notesMd: '',
        status: 'todo',
        priority: 3,
        pinned: false,
        dueAt: when,
        startAt: when,
        reminderMode: null,
        reminderOffsetMinutes: null,
        reminderAt: null,
        isAllDay: event.allDay,
        timezone: user.timezone,
        recurrenceRrule: null,
        recurrenceKind: null,
        recurrenceDtstart: null,
        completedAt: null,
        sortOrder,
        deletedAt: null,
        calendarKey: event.key,
        createdAt: now,
        updatedAt: now,
      };
      sortOrder += SORT_GAP;
      await tx.insert(tasks).values(row);
      const [created] = await tx.select().from(tasks).where(eq(tasks.id, row.id)).limit(1);
      if (!created) continue;
      await syncTaskNotifications(notifyOf(created, null), user, now, tx);
      touched.push(created);
    }
    for (const change of plan.update) {
      const current = byId.get(change.id);
      if (!current) continue;
      const when = new Date(change.event.start);
      await tx
        .update(tasks)
        .set({
          title: change.event.title,
          startAt: when,
          dueAt: when,
          isAllDay: change.event.allDay,
          timezone: user.timezone,
          updatedAt: now,
        })
        .where(and(eq(tasks.id, change.id), eq(tasks.userId, userId)));
      const [saved] = await tx.select().from(tasks).where(eq(tasks.id, change.id)).limit(1);
      if (!saved) continue;
      await syncTaskNotifications(notifyOf(saved, saved.deletedAt), user, now, tx);
      touched.push(saved);
    }
    for (const id of plan.remove) {
      const current = byId.get(id);
      if (!current) continue;
      await tx
        .update(tasks)
        .set({ deletedAt: now, calendarKey: null, updatedAt: now })
        .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
      await syncTaskNotifications(notifyOf(current, now), user, now, tx);
      removed.push(id);
    }
  });

  for (const row of touched) fireIndexTask(row);
  for (const id of removed) fireRemoveTaskIndex(id);
  const result = { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
  if (result.created + result.updated + result.removed > 0) publishInvalidation(userId);
  return result;
}
