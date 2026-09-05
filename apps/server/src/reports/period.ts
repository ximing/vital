import type { ReportType, WeekStartsOn } from '@vital/dto';
import { DateTime } from 'luxon';

export interface PeriodBounds {
  start: string;
  end: string;
  label: string;
}

function isoDate(dt: DateTime): string {
  const value = dt.toISODate();
  if (value === null) throw new Error('invalid date');
  return value;
}

function startOfWeek(day: DateTime, weekStartsOn: WeekStartsOn): DateTime {
  const start = day.startOf('day');
  const current = start.weekday % 7;
  let delta = current - weekStartsOn;
  if (delta < 0) delta += 7;
  return start.minus({ days: delta });
}

function periodFromStart(
  type: ReportType,
  start: DateTime,
  weekStartsOn: WeekStartsOn,
): PeriodBounds {
  let end: DateTime;
  switch (type) {
    case 'daily':
      end = start.plus({ days: 1 });
      break;
    case 'weekly':
      end = startOfWeek(start, weekStartsOn).plus({ days: 7 });
      break;
    case 'monthly':
      end = start.plus({ months: 1 });
      break;
    case 'yearly':
      end = start.plus({ years: 1 });
      break;
  }
  return { start: isoDate(start), end: isoDate(end), label: periodLabel(type, start, end) };
}

export function periodLabel(type: ReportType, start: DateTime, end: DateTime): string {
  switch (type) {
    case 'daily':
      return start.toFormat('yyyy年M月d日');
    case 'weekly': {
      const last = end.minus({ days: 1 });
      return `${start.toFormat('yyyy年M月d日')} – ${last.toFormat('M月d日')}`;
    }
    case 'monthly':
      return start.toFormat('yyyy年M月');
    case 'yearly':
      return start.toFormat('yyyy年');
  }
}

export function currentPeriod(
  type: ReportType,
  timezone: string,
  weekStartsOn: WeekStartsOn,
  now: DateTime = DateTime.now(),
): PeriodBounds {
  const zoned = now.setZone(timezone);
  const day = zoned.startOf('day');
  switch (type) {
    case 'daily':
      return periodFromStart(type, day, weekStartsOn);
    case 'weekly':
      return periodFromStart(type, startOfWeek(day, weekStartsOn), weekStartsOn);
    case 'monthly':
      return periodFromStart(type, day.startOf('month'), weekStartsOn);
    case 'yearly':
      return periodFromStart(type, day.startOf('year'), weekStartsOn);
  }
}

export function previousPeriodStart(type: ReportType, periodStart: string, timezone: string): string {
  const start = DateTime.fromISO(periodStart, { zone: timezone }).startOf('day');
  switch (type) {
    case 'daily':
      return isoDate(start.minus({ days: 1 }));
    case 'weekly':
      return isoDate(start.minus({ days: 7 }));
    case 'monthly':
      return isoDate(start.minus({ months: 1 }).startOf('month'));
    case 'yearly':
      return isoDate(start.minus({ years: 1 }).startOf('year'));
  }
}

export function periodInstants(
  periodStart: string,
  periodEnd: string,
  timezone: string,
): { start: Date; end: Date } {
  const start = DateTime.fromISO(periodStart, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(periodEnd, { zone: timezone }).startOf('day');
  return { start: start.toJSDate(), end: end.toJSDate() };
}

export function localDate(value: Date, timezone: string): string {
  return isoDate(DateTime.fromJSDate(value, { zone: 'utc' }).setZone(timezone).startOf('day'));
}
