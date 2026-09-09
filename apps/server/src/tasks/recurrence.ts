import { createRequire } from 'node:module';
import { DateTime } from 'luxon';
import type { Options, RRule as RRuleInstance } from 'rrule';
import { AppError } from '../errors.js';
import { matchesChinaRule, type ChinaCalendarLookup } from '../holidays/china-calendar.js';

const { RRule } = createRequire(import.meta.url)('rrule') as {
  RRule: {
    new (opts: Partial<Options>): RRuleInstance;
    parseString(value: string): Partial<Options>;
  };
};

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface ParsedRrule {
  FREQ: Freq;
  INTERVAL: number;
  BYDAY?: string[];
  BYMONTHDAY?: number[];
  COUNT?: number;
  UNTIL?: string;
}

const FREQS = new Set<string>(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
const ALLOWED_KEYS = new Set([
  'FREQ',
  'INTERVAL',
  'BYDAY',
  'BYMONTHDAY',
  'COUNT',
  'UNTIL',
  'WKST',
]);
const WEEKDAY: Record<string, number> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};
const WEEKDAY_FROM: Record<number, string> = {
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
  7: 'SU',
};

export interface RecurrenceTask {
  timezone: string;
  isAllDay: boolean;
  dueAt: Date | null;
  startAt: Date | null;
  recurrenceRrule: string | null;
  recurrenceDtstart: Date | null;
  status: string;
  id: string;
  listId: string;
  title: string;
  priority: number;
  pinned: boolean;
}

export interface CalendarInstance {
  taskId: string;
  listId: string;
  title: string;
  occurrenceAt: Date;
  isAllDay: boolean;
  status: 'todo' | 'doing' | 'done' | 'canceled';
  priority: number;
  pinned: boolean;
}

export type FixedRecurrenceKind =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'weekdays'
  | 'weekends'
  | 'holidays'
  | 'legal_workdays';

export type FixedRecurrenceTask = Pick<RecurrenceTask, 'dueAt' | 'timezone' | 'isAllDay'> & {
  recurrenceKind: FixedRecurrenceKind;
};

export type FixedCalendarTask = RecurrenceTask & {
  recurrenceKind: FixedRecurrenceKind;
};

function invalid(): never {
  throw AppError.of(400, 'RRULE_INVALID');
}

export function parseRrule(raw: string): ParsedRrule {
  const stripped = raw.trim().replace(/^RRULE:/i, '');
  if (stripped === '') invalid();
  const parts = stripped.split(';').filter((part) => part.length > 0);
  const map = new Map<string, string>();
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 1) invalid();
    const key = part.slice(0, eq).toUpperCase();
    const value = part.slice(eq + 1);
    if (!ALLOWED_KEYS.has(key)) invalid();
    map.set(key, value);
  }
  const freqRaw = map.get('FREQ');
  if (freqRaw === undefined || !FREQS.has(freqRaw.toUpperCase())) invalid();
  const freq = freqRaw.toUpperCase() as Freq;
  const intervalRaw = map.get('INTERVAL');
  let interval = 1;
  if (intervalRaw !== undefined) {
    const parsed = Number(intervalRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) invalid();
    interval = parsed;
  }
  const wkst = map.get('WKST');
  if (wkst !== undefined && wkst.toUpperCase() !== 'MO') invalid();

  const bydayRaw = map.get('BYDAY');
  let BYDAY: string[] | undefined;
  if (bydayRaw !== undefined) {
    BYDAY = bydayRaw.split(',').map((token) => token.trim().toUpperCase());
    if (BYDAY.length === 0 || BYDAY.some((token) => !/^(?:-?[1-9]|-?1[0-9]|-?2[0-9]|-?3[0-5])?[A-Z]{2}$/.test(token))) {
      invalid();
    }
    for (const token of BYDAY) {
      const wd = token.slice(-2);
      if (WEEKDAY[wd] === undefined) invalid();
    }
  }

  const bymonthdayRaw = map.get('BYMONTHDAY');
  let BYMONTHDAY: number[] | undefined;
  if (bymonthdayRaw !== undefined) {
    BYMONTHDAY = bymonthdayRaw.split(',').map((token) => Number(token.trim()));
    if (
      BYMONTHDAY.length === 0 ||
      BYMONTHDAY.some((n) => !Number.isInteger(n) || n === 0 || n < -31 || n > 31)
    ) {
      invalid();
    }
  }

  const countRaw = map.get('COUNT');
  let COUNT: number | undefined;
  if (countRaw !== undefined) {
    const parsed = Number(countRaw);
    if (!Number.isInteger(parsed) || parsed < 1) invalid();
    COUNT = parsed;
  }

  const UNTIL = map.get('UNTIL');

  const parsed: ParsedRrule = { FREQ: freq, INTERVAL: interval };
  if (BYDAY !== undefined) parsed.BYDAY = BYDAY;
  if (BYMONTHDAY !== undefined) parsed.BYMONTHDAY = BYMONTHDAY;
  if (COUNT !== undefined) parsed.COUNT = COUNT;
  if (UNTIL !== undefined) parsed.UNTIL = UNTIL;
  return parsed;
}

function daysBetween(a: DateTime, b: DateTime): number {
  return Math.round(b.startOf('day').diff(a.startOf('day'), 'days').days);
}

function startOfWeekMonday(d: DateTime): DateTime {
  return d.startOf('day').minus({ days: d.weekday - 1 });
}

function nthWeekdayMatches(cursor: DateTime, token: string): boolean {
  const wd = WEEKDAY[token.slice(-2)];
  if (wd === undefined) return false;
  const prefix = token.slice(0, -2);
  if (prefix === '') return cursor.weekday === wd;
  const nth = Number(prefix);
  if (!Number.isInteger(nth) || nth === 0) return false;
  if (nth > 0) {
    const first = cursor.startOf('month');
    const offset = (wd - first.weekday + 7) % 7;
    const day = 1 + offset + (nth - 1) * 7;
    return cursor.day === day;
  }
  const last = cursor.endOf('month').startOf('day');
  const offset = (last.weekday - wd + 7) % 7;
  const day = last.day - offset + (nth + 1) * 7;
  return day >= 1 && cursor.day === day;
}

function parseUntil(raw: string, zone: string): DateTime {
  if (/^\d{8}$/.test(raw)) {
    const dt = DateTime.fromFormat(raw, 'yyyyMMdd', { zone }).startOf('day');
    if (!dt.isValid) invalid();
    return dt;
  }
  if (/^\d{8}T\d{6}Z$/.test(raw)) {
    const dt = DateTime.fromFormat(raw, "yyyyMMdd'T'HHmmss'Z'", { zone: 'utc' })
      .setZone(zone)
      .startOf('day');
    if (!dt.isValid) invalid();
    return dt;
  }
  const dt = DateTime.fromISO(raw, { zone }).startOf('day');
  if (!dt.isValid) invalid();
  return dt;
}

export function matchesAllDay(
  cursor: DateTime,
  dtstart: DateTime,
  opts: ParsedRrule,
  interval: number,
): boolean {
  switch (opts.FREQ) {
    case 'DAILY':
      return daysBetween(dtstart, cursor) % interval === 0;
    case 'WEEKLY': {
      const days = opts.BYDAY ?? [WEEKDAY_FROM[dtstart.weekday] ?? 'MO'];
      const codes = days.map((token) => token.slice(-2));
      const self = WEEKDAY_FROM[cursor.weekday];
      if (self === undefined || !codes.includes(self)) return false;
      const weekIndex = Math.floor(
        daysBetween(startOfWeekMonday(dtstart), startOfWeekMonday(cursor)) / 7,
      );
      return weekIndex % interval === 0;
    }
    case 'MONTHLY': {
      const monthIndex = (cursor.year - dtstart.year) * 12 + (cursor.month - dtstart.month);
      if (monthIndex % interval !== 0) return false;
      if (opts.BYMONTHDAY !== undefined && opts.BYMONTHDAY.length > 0) {
        const dim = cursor.daysInMonth ?? 0;
        return opts.BYMONTHDAY.some((d) => {
          const day = d > 0 ? d : dim + d + 1;
          return day >= 1 && day <= dim && cursor.day === day;
        });
      }
      if (opts.BYDAY !== undefined && opts.BYDAY.length > 0) {
        return opts.BYDAY.some((token) => nthWeekdayMatches(cursor, token));
      }
      return cursor.day === dtstart.day;
    }
    case 'YEARLY': {
      const yearIndex = cursor.year - dtstart.year;
      if (yearIndex % interval !== 0) return false;
      return cursor.month === dtstart.month && cursor.day === dtstart.day;
    }
  }
}

function untilLimit(opts: ParsedRrule, zone: string): DateTime | null {
  if (opts.UNTIL === undefined) return null;
  return parseUntil(opts.UNTIL, zone);
}

/** Walk calendar days — FREQ hops from a Monday never land on Wednesday. */
export function allDayDates(task: RecurrenceTask, fromUtc: Date, toUtc: Date): DateTime[] {
  if (!task.recurrenceRrule || !task.recurrenceDtstart) return [];
  const zone = task.timezone;
  const dtstart = DateTime.fromJSDate(task.recurrenceDtstart, { zone }).startOf('day');
  const from = DateTime.fromJSDate(fromUtc, { zone }).startOf('day');
  const to = DateTime.fromJSDate(toUtc, { zone }).startOf('day');
  const opts = parseRrule(task.recurrenceRrule);
  const until = untilLimit(opts, zone);
  const interval = opts.INTERVAL;
  const out: DateTime[] = [];
  let emittedFromStart = 0;
  let cursor = dtstart;
  let safety = 0;
  const maxSafety = 366 * 20;
  while (cursor <= to && safety++ < maxSafety) {
    if (until && cursor > until) break;
    if (matchesAllDay(cursor, dtstart, opts, interval)) {
      emittedFromStart += 1;
      if (opts.COUNT !== undefined && emittedFromStart > opts.COUNT) break;
      if (cursor >= from && cursor <= to) {
        out.push(cursor);
        if (out.length > 400) throw AppError.of(400, 'RRULE_TOO_DENSE');
      }
    }
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

export function nextAllDayAfter(task: RecurrenceTask, afterDue: Date): Date | null {
  if (!task.recurrenceRrule || !task.recurrenceDtstart) return null;
  const zone = task.timezone;
  const dtstart = DateTime.fromJSDate(task.recurrenceDtstart, { zone }).startOf('day');
  const after = DateTime.fromJSDate(afterDue, { zone }).startOf('day');
  const opts = parseRrule(task.recurrenceRrule);
  const until = untilLimit(opts, zone);
  const interval = opts.INTERVAL;
  let emittedFromStart = 0;
  let cursor = dtstart;
  let safety = 0;
  const maxSafety = 366 * 20;
  while (safety++ < maxSafety) {
    if (until && cursor > until) return null;
    if (matchesAllDay(cursor, dtstart, opts, interval)) {
      emittedFromStart += 1;
      if (opts.COUNT !== undefined && emittedFromStart > opts.COUNT) return null;
      if (cursor > after) return cursor.toJSDate();
    }
    cursor = cursor.plus({ days: 1 });
  }
  return null;
}

export function nextAllDayOnOrAfter(task: RecurrenceTask, fromDue: Date): Date | null {
  if (!task.recurrenceRrule || !task.recurrenceDtstart) return null;
  const zone = task.timezone;
  const dtstart = DateTime.fromJSDate(task.recurrenceDtstart, { zone }).startOf('day');
  const from = DateTime.fromJSDate(fromDue, { zone }).startOf('day');
  const opts = parseRrule(task.recurrenceRrule);
  const until = untilLimit(opts, zone);
  const interval = opts.INTERVAL;
  let emittedFromStart = 0;
  let cursor = dtstart;
  let safety = 0;
  const maxSafety = 366 * 20;
  while (safety++ < maxSafety) {
    if (until && cursor > until) return null;
    if (matchesAllDay(cursor, dtstart, opts, interval)) {
      emittedFromStart += 1;
      if (opts.COUNT !== undefined && emittedFromStart > opts.COUNT) return null;
      if (cursor >= from) return cursor.toJSDate();
    }
    cursor = cursor.plus({ days: 1 });
  }
  return null;
}

export function makeTimedRule(task: RecurrenceTask): RRuleInstance {
  if (!task.recurrenceRrule || !task.recurrenceDtstart) invalid();
  parseRrule(task.recurrenceRrule);
  const parsed: Partial<Options> = RRule.parseString(task.recurrenceRrule.replace(/^RRULE:/i, ''));
  return new RRule({
    ...parsed,
    dtstart: task.recurrenceDtstart,
    tzid: task.timezone,
  });
}

export function rruleAfter(task: RecurrenceTask, afterDue: Date): Date | null {
  return makeTimedRule(task).after(afterDue, false);
}

export function rruleOnOrAfter(task: RecurrenceTask, fromDue: Date): Date | null {
  return makeTimedRule(task).after(new Date(fromDue.getTime() - 1), false);
}

export function nextOccurrenceAfter(task: RecurrenceTask, afterDue: Date): Date | null {
  if (!task.recurrenceRrule) return null;
  return task.isAllDay ? nextAllDayAfter(task, afterDue) : rruleAfter(task, afterDue);
}

export function nextOccurrenceOnOrAfter(task: RecurrenceTask, fromDue: Date): Date | null {
  if (!task.recurrenceRrule) return null;
  return task.isAllDay ? nextAllDayOnOrAfter(task, fromDue) : rruleOnOrAfter(task, fromDue);
}

function matchesFixedKind(
  cursor: DateTime,
  origin: DateTime,
  kind: FixedRecurrenceKind,
  lookup: ChinaCalendarLookup,
): Promise<boolean> | boolean {
  if (kind === 'daily') return true;
  if (kind === 'weekly') return cursor.weekday === origin.weekday;
  if (kind === 'monthly') return cursor.day === origin.day;
  if (kind === 'yearly') return cursor.month === origin.month && cursor.day === origin.day;
  if (kind === 'weekdays') return cursor.weekday <= 5;
  if (kind === 'weekends') return cursor.weekday >= 6;
  return matchesChinaRule(cursor.toISODate() ?? '', kind, lookup);
}

async function fixedCursorMatches(
  task: FixedRecurrenceTask,
  cursor: DateTime,
  lookup?: ChinaCalendarLookup,
): Promise<boolean> {
  if (task.dueAt === null) return false;
  const origin = DateTime.fromJSDate(task.dueAt, { zone: task.timezone });
  if (task.recurrenceKind === 'holidays' || task.recurrenceKind === 'legal_workdays') {
    return matchesChinaRule(cursor.toISODate() ?? '', task.recurrenceKind, lookup);
  }
  return matchesFixedKind(cursor, origin, task.recurrenceKind, () => Promise.resolve(null));
}

export async function nextFixedOccurrenceAfter(
  task: FixedRecurrenceTask,
  afterDue: Date,
  lookup?: ChinaCalendarLookup,
): Promise<Date | null> {
  if (task.dueAt === null) return null;
  const zone = task.timezone;
  const origin = DateTime.fromJSDate(task.dueAt, { zone });
  const after = DateTime.fromJSDate(afterDue, { zone });
  const time = {
    hour: origin.hour,
    minute: origin.minute,
    second: origin.second,
    millisecond: origin.millisecond,
  };
  for (let day = 1; day <= 400; day += 1) {
    const cursor = after.startOf('day').plus({ days: day }).set(time);
    if (await fixedCursorMatches(task, cursor, lookup)) return cursor.toJSDate();
  }
  return null;
}

export async function firstFixedOccurrenceOnOrAfter(
  task: FixedRecurrenceTask,
  fromUtc: Date,
  lookup?: ChinaCalendarLookup,
): Promise<Date | null> {
  if (task.dueAt === null) return null;
  if (task.dueAt >= fromUtc) return task.dueAt;
  const zone = task.timezone;
  const origin = DateTime.fromJSDate(task.dueAt, { zone });
  const from = DateTime.fromJSDate(fromUtc, { zone });
  const time = {
    hour: origin.hour,
    minute: origin.minute,
    second: origin.second,
    millisecond: origin.millisecond,
  };
  let cursor = from.startOf('day').set(time);
  if (cursor.toMillis() < fromUtc.getTime()) cursor = cursor.plus({ days: 1 });
  for (let day = 0; day < 400; day += 1) {
    if (await fixedCursorMatches(task, cursor, lookup)) return cursor.toJSDate();
    cursor = cursor.plus({ days: 1 });
  }
  return null;
}

function sameOccurrence(task: RecurrenceTask, a: Date, b: DateTime): boolean {
  if (task.isAllDay) {
    const zone = task.timezone;
    const left = DateTime.fromJSDate(a, { zone }).startOf('day');
    return left.hasSame(b.startOf('day'), 'day');
  }
  return a.getTime() === b.toJSDate().getTime();
}

function isAfterToday(task: RecurrenceTask, cursor: DateTime, now: DateTime): boolean {
  if (task.isAllDay) {
    return cursor.startOf('day') > now.setZone(task.timezone).startOf('day');
  }
  return cursor.toMillis() > now.toMillis();
}

function rowIfOverlaps(
  task: RecurrenceTask,
  fromUtc: Date,
  toUtc: Date,
): CalendarInstance[] {
  const instants: Date[] = [];
  if (task.dueAt && task.dueAt >= fromUtc && task.dueAt <= toUtc) instants.push(task.dueAt);
  if (
    task.startAt &&
    task.startAt >= fromUtc &&
    task.startAt <= toUtc &&
    (task.dueAt === null || task.startAt.getTime() !== task.dueAt.getTime())
  ) {
    instants.push(task.startAt);
  }
  const status =
    task.status === 'todo' ||
    task.status === 'doing' ||
    task.status === 'done' ||
    task.status === 'canceled'
      ? task.status
      : 'todo';
  return instants.map((occurrenceAt) => ({
    taskId: task.id,
    listId: task.listId,
    title: task.title,
    occurrenceAt,
    isAllDay: task.isAllDay,
    status,
    priority: task.priority,
    pinned: task.pinned,
  }));
}

export function expandTask(
  task: RecurrenceTask,
  completions: { occurrenceAt: Date }[],
  fromUtc: Date,
  toUtc: Date,
): CalendarInstance[] {
  if (!task.recurrenceRrule || !task.recurrenceDtstart) {
    return rowIfOverlaps(task, fromUtc, toUtc);
  }
  const zone = task.timezone;
  const instants: DateTime[] = task.isAllDay
    ? allDayDates(task, fromUtc, toUtc)
    : makeTimedRule(task)
        .between(fromUtc, toUtc, true)
        .map((d: Date) => DateTime.fromJSDate(d, { zone }));
  if (!task.isAllDay && instants.length > 400) {
    throw AppError.of(400, 'RRULE_TOO_DENSE');
  }
  const now = DateTime.now().setZone(zone);
  const out: CalendarInstance[] = [];
  for (const cursor of instants) {
    const completed = completions.some((c) => sameOccurrence(task, c.occurrenceAt, cursor));
    const current = task.dueAt !== null && sameOccurrence(task, task.dueAt, cursor);
    let status: CalendarInstance['status'] | null = null;
    if (completed) status = 'done';
    else if (current) {
      status =
        task.status === 'todo' ||
        task.status === 'doing' ||
        task.status === 'done' ||
        task.status === 'canceled'
          ? task.status
          : 'todo';
    } else if (isAfterToday(task, cursor, now)) status = 'todo';
    if (status === null) continue;
    out.push({
      taskId: task.id,
      listId: task.listId,
      title: task.title,
      occurrenceAt: cursor.toJSDate(),
      isAllDay: task.isAllDay,
      status,
      priority: task.priority,
      pinned: task.pinned,
    });
  }
  return out;
}

export async function expandFixedTask(
  task: FixedCalendarTask,
  completions: { occurrenceAt: Date }[],
  fromUtc: Date,
  toUtc: Date,
): Promise<CalendarInstance[]> {
  const status =
    task.status === 'todo' || task.status === 'doing' || task.status === 'done' || task.status === 'canceled'
      ? task.status
      : 'todo';
  const inRange = completions.filter(
    (completion) => completion.occurrenceAt >= fromUtc && completion.occurrenceAt <= toUtc,
  );
  const doneAt = new Set(inRange.map((completion) => completion.occurrenceAt.getTime()));
  const out: CalendarInstance[] = inRange.map((completion) => ({
    taskId: task.id,
    listId: task.listId,
    title: task.title,
    occurrenceAt: completion.occurrenceAt,
    isAllDay: task.isAllDay,
    status: 'done',
    priority: task.priority,
    pinned: task.pinned,
  }));
  const dueMs = task.dueAt?.getTime();
  let cursor = await firstFixedOccurrenceOnOrAfter(task, fromUtc);
  for (let count = 0; cursor !== null && cursor <= toUtc && count < 400; count += 1) {
    if (cursor >= fromUtc && !doneAt.has(cursor.getTime())) {
      out.push({
        taskId: task.id,
        listId: task.listId,
        title: task.title,
        occurrenceAt: cursor,
        isAllDay: task.isAllDay,
        status: dueMs === cursor.getTime() ? status : 'todo',
        priority: task.priority,
        pinned: task.pinned,
      });
    }
    cursor = await nextFixedOccurrenceAfter(task, cursor);
  }
  if (cursor !== null && cursor <= toUtc) throw AppError.of(400, 'RRULE_TOO_DENSE');
  return out;
}

export function allDayLocalMidnight(iso: string, zone: string): Date {
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(zone).startOf('day');
  if (!dt.isValid) throw AppError.of(400, 'VALIDATION_ERROR');
  return dt.toJSDate();
}
