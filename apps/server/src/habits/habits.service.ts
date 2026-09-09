import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, like, max, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type {
  CreateHabitInput,
  Habit,
  HabitKind,
  PatchHabitInput,
  Task,
} from '@vital/dto';
import { getDb } from '../db/index.js';
import { habits, tasks, type HabitRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { getInboxList, SORT_GAP } from '../lists/lists.service.js';
import { allDayLocalMidnight } from '../tasks/recurrence.js';

/** Local copy — keeps this module a leaf (tasks.service imports us for the relay). */
async function nextTaskSortOrder(listId: string): Promise<number> {
  const [agg] = await getDb()
    .select({ m: max(tasks.sortOrder) })
    .from(tasks)
    .where(and(eq(tasks.listId, listId), isNull(tasks.parentId)));
  return (agg?.m ?? 0) + SORT_GAP;
}

/** Built-in templates offered on the empty state. */
export const HABIT_TEMPLATES: CreateHabitInput[] = [
  { name: '喝水', kind: 'count', targetCount: 8, windowStart: '08:00', windowEnd: '22:00' },
  { name: '锻炼', kind: 'daily' },
  { name: '阅读', kind: 'daily' },
];

export function toHabitDto(row: HabitRow, todayDone = 0, todayTotal = 0): Habit {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as HabitKind,
    targetCount: row.targetCount,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    active: row.active,
    createdBy: row.createdBy === 'agent' ? 'agent' : 'user',
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    todayDone,
    todayTotal,
  };
}

export async function getOwnedHabitOr404(userId: string, id: string): Promise<HabitRow> {
  const [row] = await getDb().select().from(habits).where(eq(habits.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

function habitDay(now: Date, timezone: string): string {
  const day = DateTime.fromJSDate(now).setZone(timezone).toISODate();
  if (!day) throw new Error('invalid local date');
  return day;
}

/** Today's progress for a habit: completed instances vs spawned instances. */
async function todayProgress(
  userId: string,
  habitId: string,
  day: string,
): Promise<{ done: number; total: number }> {
  const rows = await getDb()
    .select({ status: tasks.status })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.habitId, habitId),
        like(tasks.habitKey, `${habitId}:${day}:%`),
        isNull(tasks.deletedAt),
      ),
    );
  const done = rows.filter((r) => r.status === 'done').length;
  return { done, total: rows.length };
}

export async function listHabits(userId: string, timezone: string, now = new Date()): Promise<Habit[]> {
  const rows = await getDb()
    .select()
    .from(habits)
    .where(eq(habits.userId, userId))
    .orderBy(asc(habits.sortOrder), asc(habits.createdAt));
  const day = habitDay(now, timezone);
  const out: Habit[] = [];
  for (const row of rows) {
    const progress = await todayProgress(userId, row.id, day);
    out.push(toHabitDto(row, progress.done, progress.total));
  }
  return out;
}

export async function createHabit(
  userId: string,
  input: CreateHabitInput,
  createdBy: 'user' | 'agent' = 'user',
): Promise<Habit> {
  const [maxRow] = await getDb()
    .select({ max: sql<number>`coalesce(max(${habits.sortOrder}), -1)` })
    .from(habits)
    .where(eq(habits.userId, userId));
  const [row] = await getDb()
    .insert(habits)
    .values({
      id: randomUUID(),
      userId,
      name: input.name,
      kind: input.kind,
      targetCount: input.kind === 'count' ? (input.targetCount ?? null) : null,
      windowStart: input.windowStart ?? null,
      windowEnd: input.windowEnd ?? null,
      createdBy,
      sortOrder: (maxRow?.max ?? -1) + 1,
    })
    .returning();
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return toHabitDto(row);
}

export async function patchHabit(
  userId: string,
  id: string,
  input: PatchHabitInput,
): Promise<Habit> {
  await getOwnedHabitOr404(userId, id);
  const [row] = await getDb()
    .update(habits)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.targetCount !== undefined ? { targetCount: input.targetCount } : {}),
      ...(input.windowStart !== undefined ? { windowStart: input.windowStart } : {}),
      ...(input.windowEnd !== undefined ? { windowEnd: input.windowEnd } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(eq(habits.id, id))
    .returning();
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  return toHabitDto(row);
}

export async function deleteHabit(userId: string, id: string): Promise<void> {
  await getOwnedHabitOr404(userId, id);
  await getDb().delete(habits).where(eq(habits.id, id));
}

/** Is `now` inside the habit's local-time window? No window = always. */
export function withinWindow(habit: HabitRow, now: Date, timezone: string): boolean {
  if (!habit.windowStart || !habit.windowEnd) return true;
  const hm = DateTime.fromJSDate(now).setZone(timezone).toFormat('HH:mm');
  return hm >= habit.windowStart && hm <= habit.windowEnd;
}

async function spawnInstance(
  userId: string,
  habit: HabitRow,
  day: string,
  seq: number,
  timezone: string,
): Promise<void> {
  const inbox = await getInboxList(userId);
  await getDb()
    .insert(tasks)
    .values({
      id: randomUUID(),
      userId,
      listId: inbox.id,
      habitId: habit.id,
      habitSeq: seq,
      habitKey: `${habit.id}:${day}:${String(seq)}`,
      title: habit.name,
      status: 'todo',
      priority: 3,
      dueAt: allDayLocalMidnight(day, timezone),
      isAllDay: true,
      timezone,
      sortOrder: await nextTaskSortOrder(inbox.id),
    })
    .onConflictDoNothing();
}

/**
 * Spawn today's first instances for every active habit.
 * Rule layer: skipped outside the window; idempotent via habit_key.
 */
export async function spawnDailyHabits(userId: string, timezone: string, now = new Date()): Promise<number> {
  const rows = await getDb()
    .select()
    .from(habits)
    .where(and(eq(habits.userId, userId), eq(habits.active, true)));
  const day = habitDay(now, timezone);
  let spawned = 0;
  for (const habit of rows) {
    if (!withinWindow(habit, now, timezone)) continue;
    const progress = await todayProgress(userId, habit.id, day);
    if (progress.total > 0) continue;
    await spawnInstance(userId, habit, day, 1, timezone);
    spawned += 1;
  }
  return spawned;
}

/**
 * Relay: completing one instance of a count habit spawns the next one,
 * unless the daily target is reached or the window has passed.
 */
export async function spawnNextOnComplete(userId: string, task: Task, now = new Date()): Promise<void> {
  if (!task.habitId || !task.habitSeq) return;
  const habit = await getDb()
    .select()
    .from(habits)
    .where(eq(habits.id, task.habitId))
    .limit(1)
    .then((r) => r[0]);
  if (!habit || !habit.active || habit.kind !== 'count' || habit.targetCount === null) return;
  const timezone = task.timezone;
  const day = habitDay(now, timezone);
  if (!withinWindow(habit, now, timezone)) return;
  const progress = await todayProgress(userId, habit.id, day);
  if (progress.done >= habit.targetCount) return;
  await spawnInstance(userId, habit, day, task.habitSeq + 1, timezone);
}
