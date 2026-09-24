import { DateTime } from 'luxon';
import { applyQuietHours, parseHHmm } from './quiet-hours.js';
import { MISSED_GRACE_MS } from './schedule.js';

/** Floor after a completion, shortened when the window slice is already tighter. */
export const COUNT_HABIT_FLOOR_MS = 20 * 60 * 1000;

/** Missing window end. Missing start uses the all-day notify clock instead. */
export const COUNT_HABIT_DEFAULT_END = '21:00';

export type CountHabitRemindInput = {
  targetCount: number;
  /** 1-based sequence of the single open instance. */
  seq: number;
  windowStart: string | null;
  windowEnd: string | null;
  timezone: string;
  allDayNotifyTime: string;
  /** When the previous count today was completed. */
  lastCompletedAt: Date | null;
  /** A remind for this habit was already sent today (windowless habits). */
  remindedToday: boolean;
  /** Fire time already stored on the open instance, so a catch-up does not move. */
  existingReminderAt: Date | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  now: Date;
};

/** One upcoming ring for the open instance. `occurrenceAt` is the stable slot. */
export type CountHabitRemind = {
  occurrenceAt: Date;
  scheduledAt: Date;
  done: number;
  total: number;
};

/**
 * Pace for a count habit (target >= 2). Returns the next ring on the open
 * instance, or null when this instance should stay quiet.
 * A window is split into `targetCount` slices. Either bound may be omitted.
 * No window at all: one ping at the all-day clock; only seq 1 may catch up
 * after that clock has passed.
 */
export function nextCountHabitReminder(input: CountHabitRemindInput): CountHabitRemind | null {
  if (input.targetCount < 2) return null;
  const seq = input.seq >= 1 ? input.seq : 1;
  if (seq > input.targetCount) return null;
  const day = DateTime.fromJSDate(input.now).setZone(input.timezone).toISODate();
  if (!day) return null;
  const done = seq - 1;
  const window = remindWindow(input, day);
  if (!window) return windowlessRemind(input, day, seq, done);
  return windowedRemind(input, window, day, seq, done);
}

function atHm(day: string, hm: string, zone: string): Date {
  const { hour, minute } = parseHHmm(hm);
  return DateTime.fromISO(day, { zone }).set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
}

function sameLocalDay(a: Date, b: Date, zone: string): boolean {
  return (
    DateTime.fromJSDate(a).setZone(zone).toISODate() === DateTime.fromJSDate(b).setZone(zone).toISODate()
  );
}

function remindWindow(
  input: CountHabitRemindInput,
  day: string,
): { start: Date; end: Date } | null {
  if (input.windowStart === null && input.windowEnd === null) return null;
  const start = atHm(day, input.windowStart ?? input.allDayNotifyTime, input.timezone);
  const end = atHm(day, input.windowEnd ?? COUNT_HABIT_DEFAULT_END, input.timezone);
  if (end.getTime() <= start.getTime()) return null;
  return { start, end };
}

/** Quiet-hours shift that would land on another local day is dropped. */
function deliverableAt(instant: Date, input: CountHabitRemindInput, day: string): Date | null {
  const scheduled = applyQuietHours(
    instant,
    input.quietHoursStart,
    input.quietHoursEnd,
    input.timezone,
  );
  if (DateTime.fromJSDate(scheduled).setZone(input.timezone).toISODate() !== day) return null;
  return scheduled;
}

function windowlessRemind(
  input: CountHabitRemindInput,
  day: string,
  seq: number,
  done: number,
): CountHabitRemind | null {
  if (input.remindedToday) return null;
  const morning = atHm(day, input.allDayNotifyTime, input.timezone);
  if (morning.getTime() >= input.now.getTime() - MISSED_GRACE_MS) {
    const scheduled = deliverableAt(morning, input, day);
    if (!scheduled) return null;
    return { occurrenceAt: morning, scheduledAt: scheduled, done, total: input.targetCount };
  }
  if (seq > 1) return null;
  let catchUp = input.now;
  if (
    input.existingReminderAt &&
    input.existingReminderAt.getTime() > morning.getTime() &&
    sameLocalDay(input.existingReminderAt, input.now, input.timezone)
  ) {
    catchUp = input.existingReminderAt;
  }
  if (catchUp.getTime() < input.now.getTime() - MISSED_GRACE_MS) return null;
  const scheduled = deliverableAt(catchUp, input, day);
  if (!scheduled) return null;
  return { occurrenceAt: morning, scheduledAt: scheduled, done, total: input.targetCount };
}

function windowedRemind(
  input: CountHabitRemindInput,
  window: { start: Date; end: Date },
  day: string,
  seq: number,
  done: number,
): CountHabitRemind | null {
  const span = window.end.getTime() - window.start.getTime();
  const interval = span / input.targetCount;
  const floor = Math.min(COUNT_HABIT_FLOOR_MS, interval);
  const slots: Date[] = [];
  for (let i = 0; i < input.targetCount; i += 1) {
    slots.push(new Date(Math.round(window.start.getTime() + i * interval)));
  }
  const planned = slots[seq - 1] ?? window.start;
  let first = planned.getTime();
  if (input.lastCompletedAt) {
    first = Math.max(first, input.lastCompletedAt.getTime() + floor);
  }
  if (first < window.start.getTime()) first = window.start.getTime();

  const times = [new Date(first)];
  for (const slot of slots) {
    if (slot.getTime() > first) times.push(slot);
  }

  for (const candidate of times) {
    if (candidate.getTime() >= window.end.getTime()) continue;
    const scheduled = deliverableAt(candidate, input, day);
    if (!scheduled || scheduled.getTime() >= window.end.getTime()) continue;
    if (scheduled.getTime() < input.now.getTime() - MISSED_GRACE_MS) continue;
    return { occurrenceAt: candidate, scheduledAt: scheduled, done, total: input.targetCount };
  }
  return null;
}

export function countHabitRemindMessage(done: number, total: number): string {
  return `今天 ${String(done)}/${String(total)}`;
}
