import { randomUUID } from 'node:crypto';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@vital/dto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import {
  lists,
  notificationOutbox,
  tasks,
  users,
  type NotificationOutboxPayload,
  type User,
} from '../db/schema.js';
import { countHabitRemindMessage } from './habit-remind.js';
import { resolveCountHabitRemind } from './habit-remind-db.js';
import { idempotencyKey, planWithQuietHours } from './schedule.js';

export type NotificationDb = Pick<Database, 'insert' | 'update' | 'delete' | 'select'>;

export type TaskNotifyInput = {
  id: string;
  userId: string;
  listId: string;
  title: string;
  status?: string | undefined;
  dueAt?: Date | null | undefined;
  reminderMode?: string | null | undefined;
  reminderOffsetMinutes?: number | null | undefined;
  reminderAt?: Date | null | undefined;
  isAllDay?: boolean | undefined;
  timezone: string;
  deletedAt?: Date | null | undefined;
  habitId?: string | null | undefined;
  habitSeq?: number | null | undefined;
  habitKey?: string | null | undefined;
  createdAt?: Date | null | undefined;
};

function asNotify(task: TaskNotifyInput) {
  return {
    id: task.id,
    userId: task.userId,
    listId: task.listId,
    title: task.title,
    status: task.status ?? 'todo',
    dueAt: task.dueAt ?? null,
    reminderMode:
      task.reminderMode === 'none' ||
      task.reminderMode === 'due' ||
      task.reminderMode === 'offset' ||
      task.reminderMode === 'custom'
        ? task.reminderMode
        : null,
    reminderOffsetMinutes:
      task.reminderOffsetMinutes === 5 ||
      task.reminderOffsetMinutes === 15 ||
      task.reminderOffsetMinutes === 30 ||
      task.reminderOffsetMinutes === 60 ||
      task.reminderOffsetMinutes === 1440
        ? task.reminderOffsetMinutes
        : null,
    reminderAt: task.reminderAt ?? null,
    isAllDay: task.isAllDay ?? false,
    timezone: task.timezone,
    deletedAt: task.deletedAt ?? null,
    habitId: task.habitId ?? null,
    habitSeq: task.habitSeq ?? null,
    habitKey: task.habitKey ?? null,
    createdAt: task.createdAt ?? null,
  };
}

const OPEN = ['todo', 'doing'] as const;
const LIVE = ['pending', 'sending'] as const;

export function prefsFromUser(user: User): NotificationPrefs {
  return {
    taskRemind: user.notifyTaskRemind,
    taskDue: user.notifyTaskDue,
    agentInsights: user.notifyAgentInsights,
    dayRemind: user.notifyDayRemind,
    quietHoursStart: user.quietHoursStart,
    quietHoursEnd: user.quietHoursEnd,
    allDayNotifyTime: user.allDayNotifyTime || DEFAULT_NOTIFICATION_PREFS.allDayNotifyTime,
  };
}

async function listNameOf(db: NotificationDb, listId: string): Promise<string> {
  const [row] = await db
    .select({ name: lists.name })
    .from(lists)
    .where(eq(lists.id, listId))
    .limit(1);
  return row?.name ?? '';
}

function payloadOf(
  task: ReturnType<typeof asNotify>,
  listName: string,
  eventType: 'task.remind' | 'task.due',
  scheduledAt: Date,
  message?: string,
): NotificationOutboxPayload {
  return {
    title: task.title,
    listId: task.listId,
    listName,
    dueAt: task.dueAt?.toISOString() ?? null,
    remindAt: eventType === 'task.remind' ? scheduledAt.toISOString() : null,
    isAllDay: task.isAllDay,
    timezone: task.timezone,
    eventType,
    ...(message ? { message } : {}),
  };
}

async function cancelLive(
  db: NotificationDb,
  taskId: string,
  now: Date,
  exceptKey?: string,
): Promise<void> {
  const cond = exceptKey
    ? and(
        eq(notificationOutbox.entityType, 'task'),
        inArray(notificationOutbox.eventType, ['task.remind', 'task.due']),
        eq(notificationOutbox.entityId, taskId),
        inArray(notificationOutbox.status, [...LIVE]),
        ne(notificationOutbox.idempotencyKey, exceptKey),
      )
    : and(
        eq(notificationOutbox.entityType, 'task'),
        inArray(notificationOutbox.eventType, ['task.remind', 'task.due']),
        eq(notificationOutbox.entityId, taskId),
        inArray(notificationOutbox.status, [...LIVE]),
      );
  await db.update(notificationOutbox).set({ status: 'cancelled', updatedAt: now }).where(cond);
}

function sameInstant(a: Date | null | undefined, b: Date | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}

async function writeTaskOutbox(
  db: NotificationDb,
  task: ReturnType<typeof asNotify>,
  plan: { eventType: 'task.remind' | 'task.due'; scheduledAt: Date; occurrenceAt: Date },
  now: Date,
  message?: string,
): Promise<void> {
  const key = idempotencyKey(plan.eventType, task.id, plan.occurrenceAt);
  await cancelLive(db, task.id, now, key);
  const listName = await listNameOf(db, task.listId);
  const payload = payloadOf(task, listName, plan.eventType, plan.scheduledAt, message);
  await db
    .insert(notificationOutbox)
    .values({
      id: randomUUID(),
      userId: task.userId,
      eventType: plan.eventType,
      entityType: 'task',
      entityId: task.id,
      occurrenceAt: plan.occurrenceAt,
      idempotencyKey: key,
      scheduledAt: plan.scheduledAt,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      payload,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notificationOutbox.idempotencyKey,
      set: {
        scheduledAt: plan.scheduledAt,
        payload,
        nextAttemptAt: null,
        lastError: null,
        updatedAt: now,
        status: sql`CASE WHEN ${notificationOutbox.status} = 'sent' THEN 'sent' ELSE 'pending' END`,
        attemptCount: sql`CASE WHEN ${notificationOutbox.status} = 'sent' THEN ${notificationOutbox.attemptCount} ELSE 0 END`,
      },
      // A heal tick can still hold the pre-delete row. Do not revive a
      // cancelled outbox entry after the task is gone or no longer open.
      setWhere: sql`EXISTS (
        SELECT 1 FROM ${tasks}
        WHERE ${tasks.id} = ${notificationOutbox.entityId}
          AND ${tasks.deletedAt} IS NULL
          AND ${tasks.status} IN ('todo', 'doing')
      )`,
    });
}

async function syncCountHabitReminder(
  db: NotificationDb,
  task: ReturnType<typeof asNotify>,
  ring: { occurrenceAt: Date; scheduledAt: Date; done: number; total: number } | null,
  taskRemind: boolean,
  now: Date,
): Promise<void> {
  const reminderAt = ring && taskRemind ? ring.scheduledAt : null;
  const run = async (tx: NotificationDb) => {
    if (task.reminderMode !== 'custom' || !sameInstant(task.reminderAt, reminderAt)) {
      await tx
        .update(tasks)
        .set({
          reminderMode: 'custom',
          reminderAt,
          reminderOffsetMinutes: null,
          updatedAt: now,
        })
        .where(and(eq(tasks.id, task.id), eq(tasks.userId, task.userId)));
    }
    if (!ring || !taskRemind) {
      await cancelLive(tx, task.id, now);
      return;
    }
    await writeTaskOutbox(
      tx,
      task,
      { eventType: 'task.remind', scheduledAt: ring.scheduledAt, occurrenceAt: ring.occurrenceAt },
      now,
      countHabitRemindMessage(ring.done, ring.total),
    );
  };
  if (db === getDb()) {
    await getDb().transaction(run);
    return;
  }
  await run(db);
}

export async function syncTaskNotifications(
  raw: TaskNotifyInput,
  user: User,
  now = new Date(),
  db: NotificationDb = getDb(),
): Promise<void> {
  const task = asNotify(raw);
  const prefs = prefsFromUser(user);
  if (task.deletedAt !== null || !OPEN.includes(task.status as (typeof OPEN)[number])) {
    await cancelLive(db, task.id, now);
    return;
  }
  const habit = await resolveCountHabitRemind(db, task, prefs, now);
  if (habit.kind === 'habit') {
    await syncCountHabitReminder(db, task, habit.ring, prefs.taskRemind, now);
    return;
  }
  const plan = planWithQuietHours(task, prefs, user.timezone, now);
  if (!plan) {
    await cancelLive(db, task.id, now);
    return;
  }
  await writeTaskOutbox(db, task, plan, now);
}

export async function syncTaskNotificationsById(
  userId: string,
  taskId: string,
  now = new Date(),
  db: NotificationDb = getDb(),
): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!task || !user || task.userId !== userId) return;
  await syncTaskNotifications(task, user, now, db);
}
