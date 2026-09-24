import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { habits, notificationOutbox, tasks } from '../db/schema.js';
import { nextCountHabitReminder, type CountHabitRemind } from './habit-remind.js';

type SelectDb = Pick<Database, 'select'>;

export type CountHabitTask = {
  id: string;
  userId: string;
  habitId: string | null;
  habitSeq: number | null;
  habitKey: string | null;
  reminderAt: Date | null;
  timezone: string;
};

export type CountHabitDecision =
  | { kind: 'skip' }
  | { kind: 'habit'; ring: CountHabitRemind | null };

function dayFromHabitKey(habitKey: string | null, habitId: string): string | null {
  if (!habitKey?.startsWith(`${habitId}:`)) return null;
  const day = habitKey.slice(habitId.length + 1, habitId.length + 11);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

async function remindedToday(db: SelectDb, userId: string, habitId: string, day: string): Promise<boolean> {
  const instances = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(eq(tasks.userId, userId), eq(tasks.habitId, habitId), like(tasks.habitKey, `${habitId}:${day}:%`)),
    );
  if (instances.length === 0) return false;
  const [sent] = await db
    .select({ id: notificationOutbox.id })
    .from(notificationOutbox)
    .where(
      and(
        eq(notificationOutbox.userId, userId),
        eq(notificationOutbox.eventType, 'task.remind'),
        eq(notificationOutbox.status, 'sent'),
        inArray(
          notificationOutbox.entityId,
          instances.map((row) => row.id),
        ),
      ),
    )
    .limit(1);
  return Boolean(sent);
}

/** Count habits with a target of 2+ own their remind. Everything else stays on the task planner. */
export async function resolveCountHabitRemind(
  db: SelectDb,
  task: CountHabitTask,
  prefs: { allDayNotifyTime: string; quietHoursStart: string | null; quietHoursEnd: string | null },
  now: Date,
): Promise<CountHabitDecision> {
  if (!task.habitId) return { kind: 'skip' };
  const [habit] = await db.select().from(habits).where(eq(habits.id, task.habitId)).limit(1);
  if (!habit || habit.userId !== task.userId) return { kind: 'skip' };
  if (habit.kind !== 'count' || habit.targetCount === null || habit.targetCount < 2) {
    return { kind: 'skip' };
  }
  if (!habit.active) return { kind: 'habit', ring: null };

  const day = dayFromHabitKey(task.habitKey, habit.id);
  const seq = task.habitSeq ?? 1;
  let lastCompletedAt: Date | null = null;
  if (day && seq > 1) {
    const [prev] = await db
      .select({ completedAt: tasks.completedAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, task.userId),
          eq(tasks.habitId, habit.id),
          eq(tasks.habitSeq, seq - 1),
          like(tasks.habitKey, `${habit.id}:${day}:%`),
          eq(tasks.status, 'done'),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    lastCompletedAt = prev?.completedAt ?? null;
  }

  const windowless = habit.windowStart === null && habit.windowEnd === null;
  const ring = nextCountHabitReminder({
    targetCount: habit.targetCount,
    seq,
    windowStart: habit.windowStart,
    windowEnd: habit.windowEnd,
    timezone: task.timezone,
    allDayNotifyTime: prefs.allDayNotifyTime,
    lastCompletedAt,
    remindedToday: windowless && day ? await remindedToday(db, task.userId, habit.id, day) : false,
    existingReminderAt: task.reminderAt,
    quietHoursStart: prefs.quietHoursStart,
    quietHoursEnd: prefs.quietHoursEnd,
    now,
  });
  return { kind: 'habit', ring };
}
