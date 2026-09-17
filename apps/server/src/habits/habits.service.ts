import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, like, max, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type {
  CreateHabitInput,
  Habit,
  HabitCheckin,
  HabitCheckinsResponse,
  HabitKind,
  PatchHabitInput,
  Task,
} from '@vital/dto';
import { getDb } from '../db/index.js';
import { habits, tasks, type HabitRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import { enqueueOutcomeRefresh } from '../agent/jobs.js';
import { getUserEntity } from '../auth/auth.service.js';
import { getInboxList, SORT_GAP } from '../lists/lists.service.js';
import { syncTaskNotifications } from '../notifications/outbox.js';
import { assertOwnedOutcomeId } from '../outcomes/shared.js';
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
    outcomeId: row.outcomeId,
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

/** `{habitId}:{YYYY-MM-DD}:{seq}` — the local day the instance belongs to. */
export function dayFromHabitKey(habitKey: string | null, habitId: string | null): string | null {
  if (!habitKey || !habitId) return null;
  const prefix = `${habitId}:`;
  if (!habitKey.startsWith(prefix)) return null;
  const day = habitKey.slice(prefix.length, prefix.length + 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return day;
}

/** Today's progress for habits: completed instances vs spawned instances. */
async function todayProgressByHabits(
  userId: string,
  habitIds: string[],
  day: string,
): Promise<Map<string, { done: number; total: number }>> {
  const map = new Map<string, { done: number; total: number }>();
  for (const id of habitIds) map.set(id, { done: 0, total: 0 });
  if (habitIds.length === 0) return map;
  const rows = await getDb()
    .select({ habitId: tasks.habitId, status: tasks.status, habitKey: tasks.habitKey })
    .from(tasks)
    .where(
      and(eq(tasks.userId, userId), inArray(tasks.habitId, habitIds), isNull(tasks.deletedAt)),
    );
  for (const row of rows) {
    if (!row.habitId || !row.habitKey?.startsWith(`${row.habitId}:${day}:`)) continue;
    const rec = map.get(row.habitId);
    if (!rec) continue;
    rec.total += 1;
    if (row.status === 'done') rec.done += 1;
  }
  return map;
}

async function todayProgress(
  userId: string,
  habitId: string,
  day: string,
): Promise<{ done: number; total: number }> {
  const map = await todayProgressByHabits(userId, [habitId], day);
  return map.get(habitId) ?? { done: 0, total: 0 };
}

export async function listHabits(userId: string, timezone: string, now = new Date()): Promise<Habit[]> {
  await expireStaleHabitInstances(userId, timezone, now);
  const rows = await getDb()
    .select()
    .from(habits)
    .where(eq(habits.userId, userId))
    .orderBy(asc(habits.sortOrder), asc(habits.createdAt));
  const day = habitDay(now, timezone);
  const progress = await todayProgressByHabits(
    userId,
    rows.map((row) => row.id),
    day,
  );
  return rows.map((row) => {
    const rec = progress.get(row.id) ?? { done: 0, total: 0 };
    return toHabitDto(row, rec.done, rec.total);
  });
}

/**
 * Soft-delete open habit instances whose local day is before today.
 * Daily habits (喝水 / 锻炼 / …) do not carry — a miss stays a miss.
 */
export async function expireStaleHabitInstances(
  userId: string,
  timezone: string,
  now = new Date(),
): Promise<number> {
  const day = habitDay(now, timezone);
  const open = await getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNotNull(tasks.habitId),
        inArray(tasks.status, ['todo', 'doing']),
        isNull(tasks.deletedAt),
      ),
    );
  const stale = open.filter((task) => {
    const keyDay = dayFromHabitKey(task.habitKey, task.habitId);
    return keyDay !== null && keyDay < day;
  });
  if (stale.length === 0) return 0;
  const user = await getUserEntity(userId);
  const at = new Date();
  await getDb().transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ deletedAt: at, updatedAt: at })
      .where(
        and(eq(tasks.userId, userId), inArray(tasks.id, stale.map((row) => row.id))),
      );
    for (const instance of stale) {
      await syncTaskNotifications({ ...instance, deletedAt: at }, user, at, tx);
    }
  });
  return stale.length;
}

export async function listHabitCheckins(
  userId: string,
  from: string,
  to: string,
): Promise<HabitCheckinsResponse> {
  const rows = await getDb()
    .select({ habitId: tasks.habitId, habitKey: tasks.habitKey })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNotNull(tasks.habitId),
        eq(tasks.status, 'done'),
        isNull(tasks.deletedAt),
      ),
    );
  const byHabit = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const date = dayFromHabitKey(row.habitKey, row.habitId);
    if (!date || !row.habitId || date < from || date > to) continue;
    const days = byHabit.get(row.habitId) ?? new Map<string, number>();
    days.set(date, (days.get(date) ?? 0) + 1);
    byHabit.set(row.habitId, days);
  }
  const items: HabitCheckin[] = [];
  for (const [habitId, days] of byHabit) {
    items.push({
      habitId,
      days: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, done]) => ({ date, done })),
    });
  }
  return { items };
}

export async function createHabit(
  userId: string,
  input: CreateHabitInput,
  createdBy: 'user' | 'agent' = 'user',
): Promise<Habit> {
  if (input.outcomeId) await assertOwnedOutcomeId(userId, input.outcomeId);
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
      outcomeId: input.outcomeId ?? null,
    })
    .returning();
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  if (row.outcomeId) await enqueueOutcomeRefresh(getDb(), userId, row.outcomeId, new Date());
  return toHabitDto(row);
}

export async function patchHabit(
  userId: string,
  id: string,
  input: PatchHabitInput,
): Promise<Habit> {
  const prev = await getOwnedHabitOr404(userId, id);
  if (input.outcomeId) await assertOwnedOutcomeId(userId, input.outcomeId);
  const [row] = await getDb()
    .update(habits)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.targetCount !== undefined ? { targetCount: input.targetCount } : {}),
      ...(input.windowStart !== undefined ? { windowStart: input.windowStart } : {}),
      ...(input.windowEnd !== undefined ? { windowEnd: input.windowEnd } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.outcomeId !== undefined ? { outcomeId: input.outcomeId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(habits.id, id))
    .returning();
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  if (input.outcomeId !== undefined) {
    const now = new Date();
    if (row.outcomeId) await enqueueOutcomeRefresh(getDb(), userId, row.outcomeId, now);
    if (prev.outcomeId && prev.outcomeId !== row.outcomeId) {
      await enqueueOutcomeRefresh(getDb(), userId, prev.outcomeId, now);
    }
  }
  return toHabitDto(row);
}

export async function listHabitsForOutcome(
  userId: string,
  outcomeId: string,
  timezone: string,
  now = new Date(),
): Promise<Habit[]> {
  return (await listHabits(userId, timezone, now)).filter((habit) => habit.outcomeId === outcomeId);
}

export async function deleteHabit(userId: string, id: string): Promise<void> {
  await getOwnedHabitOr404(userId, id);
  const user = await getUserEntity(userId);
  const now = new Date();
  await getDb().transaction(async (tx) => {
    const open = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.habitId, id),
          inArray(tasks.status, ['todo', 'doing']),
          isNull(tasks.deletedAt),
        ),
      );
    if (open.length > 0) {
      await tx
        .update(tasks)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(tasks.userId, userId),
            eq(tasks.habitId, id),
            inArray(tasks.status, ['todo', 'doing']),
            isNull(tasks.deletedAt),
          ),
        );
      for (const instance of open) {
        await syncTaskNotifications({ ...instance, deletedAt: now }, user, now, tx);
      }
    }
    await tx
      .update(tasks)
      .set({ habitId: null, habitSeq: null, habitKey: null, updatedAt: now })
      .where(and(eq(tasks.userId, userId), eq(tasks.habitId, id)));
    await tx.delete(habits).where(and(eq(habits.id, id), eq(habits.userId, userId)));
  });
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
 * Open today's instance for an explicit tick. Spawns the next seq when the
 * relay has nothing left (e.g. after the window closed mid-target).
 */
export async function ensureOpenTodayInstance(
  userId: string,
  habitId: string,
  timezone: string,
  now = new Date(),
): Promise<string | null> {
  const habit = await getOwnedHabitOr404(userId, habitId);
  if (!habit.active) return null;
  const day = habitDay(now, timezone);
  const progress = await todayProgress(userId, habit.id, day);
  const target =
    habit.kind === 'count' && habit.targetCount !== null && habit.targetCount > 0
      ? habit.targetCount
      : 1;
  if (progress.done >= target) return null;

  const openWhere = and(
    eq(tasks.userId, userId),
    eq(tasks.habitId, habit.id),
    like(tasks.habitKey, `${habit.id}:${day}:%`),
    inArray(tasks.status, ['todo', 'doing']),
    isNull(tasks.deletedAt),
  );
  const [open] = await getDb().select({ id: tasks.id }).from(tasks).where(openWhere).limit(1);
  if (open) return open.id;

  await spawnInstance(userId, habit, day, progress.total + 1, timezone);
  const [spawned] = await getDb().select({ id: tasks.id }).from(tasks).where(openWhere).limit(1);
  return spawned?.id ?? null;
}

/**
 * Spawn today's first instances for every active habit.
 * Rule layer: skipped outside the window; idempotent via habit_key.
 */
export async function spawnDailyHabits(userId: string, timezone: string, now = new Date()): Promise<number> {
  await expireStaleHabitInstances(userId, timezone, now);
  const rows = await getDb()
    .select()
    .from(habits)
    .where(and(eq(habits.userId, userId), eq(habits.active, true)));
  const day = habitDay(now, timezone);
  const progressByHabit = await todayProgressByHabits(
    userId,
    rows.map((habit) => habit.id),
    day,
  );
  let spawned = 0;
  for (const habit of rows) {
    if (!withinWindow(habit, now, timezone)) continue;
    const progress = progressByHabit.get(habit.id) ?? { done: 0, total: 0 };
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
