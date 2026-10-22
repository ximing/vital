import type { Habit, HabitCheckin, HabitCheckinDay } from '@vital/dto';
import { habitTodayProgress } from '@/features/today';
import { addDaysYmd, padYmd, ymdParts } from '@/lib/calendar-grid';

export function todayOf(habit: Habit): { done: number; total: number; complete: boolean } {
  return habitTodayProgress(habit);
}

/* ===== derived stats (checkin days → streak / rates) ===== */

export type DayMap = Map<string, number>;

export function dayMap(days: HabitCheckinDay[]): DayMap {
  return new Map(days.map((row) => [row.date, row.done]));
}

/** Consecutive 达标 days ending today; an incomplete today does not break the run. */
export function streakOf(days: DayMap, total: number, createdOn: string, today: string): number {
  let cursor = (days.get(today) ?? 0) >= total ? today : addDaysYmd(today, -1);
  let streak = 0;
  while (cursor >= createdOn && (days.get(cursor) ?? 0) >= total) {
    streak += 1;
    cursor = addDaysYmd(cursor, -1);
  }
  return streak;
}

export function weekStartYmd(today: string, weekStartsOn: 0 | 1): string {
  const { y, m, d } = ymdParts(today);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysYmd(today, -((dow - weekStartsOn + 7) % 7));
}

/** hit/eligible habit-days within [from, to]; days before creation don't count. */
export function hitDays(
  days: DayMap,
  total: number,
  from: string,
  to: string,
): { hit: number; eligible: number } {
  let hit = 0;
  let eligible = 0;
  let cursor = from;
  while (cursor <= to) {
    eligible += 1;
    if ((days.get(cursor) ?? 0) >= total) hit += 1;
    cursor = addDaysYmd(cursor, 1);
  }
  return { hit, eligible };
}

export function monthRange(monthCursor: string): { from: string; to: string } {
  const { y, m } = ymdParts(monthCursor);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: padYmd(y, m, 1), to: padYmd(y, m, last) };
}

export function checkinsFor(items: HabitCheckin[] | undefined, habitId: string) {
  return items?.find((row) => row.habitId === habitId)?.days ?? [];
}
