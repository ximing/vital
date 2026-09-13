import { and, eq, gte, isNotNull, isNull, like } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getDb } from '../db/index.js';
import { habits, taskCompletions, tasks } from '../db/schema.js';

export interface HabitHeadlineFact {
  id: string;
  name: string;
  kind: 'daily' | 'count';
  targetCount: number | null;
  outcomeId: string | null;
  active: boolean;
  sortOrder: number;
  /** Distinct local days with ≥1 completion in the last 7 days. */
  daysDoneLast7d: number;
  /** Distinct local days with ≥1 completion in the previous 7 days. */
  daysDonePrev7d: number;
  todayDone: number;
  todayTarget: number;
  lastCompletedAt: Date | null;
}

function localDay(at: Date, timezone: string): string {
  return DateTime.fromJSDate(at).setZone(timezone).toISODate() ?? '';
}

function todayTargetOf(kind: string, targetCount: number | null): number {
  return kind === 'count' && targetCount !== null && targetCount > 0 ? targetCount : 1;
}

/**
 * Per-habit facts for headline / rule / stats. Habit instances are not thread
 * tasks; this is how a thread sees 锻炼 / 喝水 progress.
 */
export async function loadHabitHeadlineFacts(
  userId: string,
  timezone: string,
  now = new Date(),
): Promise<HabitHeadlineFact[]> {
  const rows = await getDb()
    .select({
      id: habits.id,
      name: habits.name,
      kind: habits.kind,
      targetCount: habits.targetCount,
      outcomeId: habits.outcomeId,
      active: habits.active,
      sortOrder: habits.sortOrder,
    })
    .from(habits)
    .where(eq(habits.userId, userId));
  if (rows.length === 0) return [];

  const day = localDay(now, timezone);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  const habitIds = rows.map((row) => row.id);

  const instanceRows = await getDb()
    .select({ habitId: tasks.habitId, status: tasks.status, habitKey: tasks.habitKey })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNotNull(tasks.habitId),
        isNull(tasks.deletedAt),
        like(tasks.habitKey, `%:${day}:%`),
      ),
    );
  const todayByHabit = new Map<string, { done: number; total: number }>();
  for (const id of habitIds) todayByHabit.set(id, { done: 0, total: 0 });
  for (const row of instanceRows) {
    if (!row.habitId || !row.habitKey?.startsWith(`${row.habitId}:${day}:`)) continue;
    const rec = todayByHabit.get(row.habitId);
    if (!rec) continue;
    rec.total += 1;
    if (row.status === 'done') rec.done += 1;
  }

  const doneRows = await getDb()
    .select({ habitId: tasks.habitId, completedAt: taskCompletions.completedAt })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(tasks.userId, userId),
        isNotNull(tasks.habitId),
        gte(taskCompletions.completedAt, twoWeeksAgo),
      ),
    );
  const lastDaysByHabit = new Map<string, Set<string>>();
  const prevDaysByHabit = new Map<string, Set<string>>();
  const lastByHabit = new Map<string, Date>();
  for (const row of doneRows) {
    if (!row.habitId) continue;
    const at = row.completedAt instanceof Date ? row.completedAt : new Date(row.completedAt);
    const bucket = at >= weekAgo ? lastDaysByHabit : prevDaysByHabit;
    const set = bucket.get(row.habitId) ?? new Set<string>();
    set.add(localDay(at, timezone));
    bucket.set(row.habitId, set);
    const prev = lastByHabit.get(row.habitId);
    if (!prev || at > prev) lastByHabit.set(row.habitId, at);
  }

  return rows.map((row) => {
    const today = todayByHabit.get(row.id) ?? { done: 0, total: 0 };
    const todayTarget = todayTargetOf(row.kind, row.targetCount);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind === 'count' ? 'count' : 'daily',
      targetCount: row.targetCount,
      outcomeId: row.outcomeId,
      active: row.active,
      sortOrder: row.sortOrder,
      daysDoneLast7d: lastDaysByHabit.get(row.id)?.size ?? 0,
      daysDonePrev7d: prevDaysByHabit.get(row.id)?.size ?? 0,
      todayDone: Math.min(today.done, todayTarget),
      todayTarget,
      lastCompletedAt: lastByHabit.get(row.id) ?? null,
    };
  });
}

export function linkedHabitFacts(facts: HabitHeadlineFact[], outcomeId: string): HabitHeadlineFact[] {
  return facts.filter((fact) => fact.active && fact.outcomeId === outcomeId);
}

export function unlinkedHabitFacts(facts: HabitHeadlineFact[]): HabitHeadlineFact[] {
  return facts.filter((fact) => fact.active && fact.outcomeId === null);
}
