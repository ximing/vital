import { addDaysYmd, ymdInTimeZone } from '@vital/dto';
import { DateTime } from 'luxon';
import type { PauseRange } from './types.js';

export const DEFAULT_GRACE_HOURS = 12;

export function graceHoursOf(cadence: { graceHours?: number }): number {
  return cadence.graceHours ?? DEFAULT_GRACE_HOURS;
}

export function localYmd(instant: Date, timeZone: string): string {
  return ymdInTimeZone(instant, timeZone);
}

/** JS weekday: 0 Sunday … 6 Saturday. */
export function weekdayOfYmd(ymd: string): number {
  const { year, month, day } = parseYmd(ymd);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function startOfWeekYmd(ymd: string, weekStartsOn: 0 | 1): string {
  const delta = (weekdayOfYmd(ymd) - weekStartsOn + 7) % 7;
  return addDaysYmd(ymd, -delta);
}

export function zonedDateTime(ymd: string, hm: string, timeZone: string): Date {
  const { year, month, day } = parseYmd(ymd);
  const { hour, minute } = parseHm(hm);
  const dt = DateTime.fromObject(
    { year, month, day, hour, minute, second: 0, millisecond: 0 },
    { zone: timeZone },
  );
  return dt.toJSDate();
}

export function plusMinutes(instant: Date, minutes: number): Date {
  return DateTime.fromJSDate(instant).plus({ minutes }).toJSDate();
}

export function plusHours(instant: Date, hours: number): Date {
  return DateTime.fromJSDate(instant).plus({ hours }).toJSDate();
}

export function eachYmd(startYmd: string, endYmd: string): string[] {
  const days: string[] = [];
  let cursor = startYmd;
  while (cursor <= endYmd) {
    days.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return days;
}

/** [aStart, aEnd) vs [bStart, bEnd). Null bEnd is open-ended. */
export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date | null,
): boolean {
  const bEndMs = bEnd === null ? Number.POSITIVE_INFINITY : bEnd.getTime();
  return aStart.getTime() < bEndMs && bStart.getTime() < aEnd.getTime();
}

export function overlapsPauseRanges(
  startsAt: Date,
  checkAt: Date,
  ranges: readonly PauseRange[],
): boolean {
  return ranges.some((range) => intervalsOverlap(startsAt, checkAt, range.start, range.end));
}

export function isPausedAt(now: Date, ranges: readonly PauseRange[]): boolean {
  const t = now.getTime();
  return ranges.some(
    (range) => range.start.getTime() <= t && (range.end === null || range.end.getTime() > t),
  );
}

function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const [year, month, day] = ymd.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 1, day: day ?? 1 };
}

function parseHm(hm: string): { hour: number; minute: number } {
  const [hour, minute] = hm.split(':').map(Number);
  return { hour: hour ?? 0, minute: minute ?? 0 };
}
