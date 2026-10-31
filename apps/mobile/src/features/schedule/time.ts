import { addDaysYmd, addMonthsYmd } from '../../lib/calendar-grid';
import {
  formatHm,
  localDateStamp,
  zonedLocalMidnightIso as midnightIso,
  zonedWallTimeIso,
} from '../../lib/format';

export { addDaysYmd, addMonthsYmd, formatHm, zonedWallTimeIso };

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Local `YYYY-MM-DD` of an instant in `timeZone`. */
export function formatYmd(date: Date, timeZone: string): string {
  return localDateStamp(timeZone, date);
}

/** UTC instant of local midnight. Argument order matches the schedule grid. */
export function zonedLocalMidnightIso(ymd: string, timeZone: string): string {
  return midnightIso(timeZone, ymd);
}

export function weekdayInZone(ymd: string, timeZone: string): number {
  const instant = new Date(zonedLocalMidnightIso(ymd, timeZone));
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  return WEEKDAY_SHORT[short] ?? 0;
}

/** Week start on the timezone's wall calendar, not a UTC weekday slice. */
export function startOfWeekYmd(ymd: string, weekStartsOn: 0 | 1, timeZone: string): string {
  const dow = weekdayInZone(ymd, timeZone);
  const delta = (dow - weekStartsOn + 7) % 7;
  return addDaysYmd(ymd, -delta);
}

export function weekYmids(anchorYmd: string, weekStartsOn: 0 | 1, timeZone: string): string[] {
  const start = startOfWeekYmd(anchorYmd, weekStartsOn, timeZone);
  return Array.from({ length: 7 }, (_, index) => addDaysYmd(start, index));
}

export function weekRangeIso(
  anchorYmd: string,
  weekStartsOn: 0 | 1,
  timeZone: string,
): { from: string; to: string; days: string[] } {
  const days = weekYmids(anchorYmd, weekStartsOn, timeZone);
  const start = days[0] ?? anchorYmd;
  const endExclusive = addDaysYmd(start, 7);
  const from = zonedLocalMidnightIso(start, timeZone);
  const to = new Date(new Date(zonedLocalMidnightIso(endExclusive, timeZone)).getTime() - 1).toISOString();
  return { from, to, days };
}
