import { DateTime } from 'luxon';
import { applyQuietHours, parseHHmm } from './quiet-hours.js';
import { MISSED_GRACE_MS } from './schedule.js';

/**
 * Soonest a late cup may ring. The effective gap is the wider of this and half
 * a slice, and never a reason to ping faster than that.
 */
export const COUNT_HABIT_MIN_GAP_MS = 75 * 60 * 1000;

/** One nudge when the planned ring may have been missed. */
export const COUNT_HABIT_FOLLOW_UP_MS = 45 * 60 * 1000;

/** No new catch-up rings in the last 90 minutes of the window. */
export const COUNT_HABIT_WIND_DOWN_MS = 90 * 60 * 1000;

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
 * A window is split into `targetCount` slices. On pace, the open cup keeps its
 * slice. Behind, the next cup is the remaining time divided by the remaining
 * cups, clamped to a healthy gap. A missed ring gets one follow-up, then skips
 * a cycle. No window at all: one ping at the all-day clock; only seq 1 may
 * catch up after that clock has passed.
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
  return DateTime.fromISO(day, { zone })
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toJSDate();
}

function sameLocalDay(a: Date, b: Date, zone: string): boolean {
  return (
    DateTime.fromJSDate(a).setZone(zone).toISODate() ===
    DateTime.fromJSDate(b).setZone(zone).toISODate()
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

type RingKind = 'slot' | 'follow' | 'reflow';

type Ring = { at: number; kind: RingKind };

/** Gap until the next cup. Never shorter than the healthy minimum. */
function paceMs(remainingMs: number, left: number, sliceMs: number): number {
  const minGap = Math.max(COUNT_HABIT_MIN_GAP_MS, sliceMs / 2);
  if (!(left > 0) || minGap >= sliceMs) return minGap;
  const raw = remainingMs / left;
  return Math.min(Math.max(raw, minGap), sliceMs);
}

function gridRings(slots: number[], fromIndex: number, endMs: number): Ring[] {
  const rings: Ring[] = [];
  for (let i = fromIndex; i < slots.length; i += 2) {
    const slot = slots[i];
    if (slot === undefined || slot >= endMs) break;
    rings.push({ at: slot, kind: 'slot' });
    const follow = slot + COUNT_HABIT_FOLLOW_UP_MS;
    if (follow < endMs) rings.push({ at: follow, kind: 'follow' });
  }
  return rings;
}

function reflowRings(anchorMs: number, sliceMs: number, endMs: number, limit: number): Ring[] {
  const rings: Ring[] = [];
  for (let k = 0; k < limit; k += 1) {
    const primary = Math.round(anchorMs + k * 2 * sliceMs);
    if (primary >= endMs) break;
    rings.push({ at: primary, kind: 'reflow' });
    const follow = primary + COUNT_HABIT_FOLLOW_UP_MS;
    if (follow < endMs) rings.push({ at: follow, kind: 'reflow' });
  }
  return rings;
}

/** Catch-up rings stop 90 minutes before the window ends. Planned slots may still ring. */
function visibleInWindow(ring: Ring, windDownAt: number, endMs: number): boolean {
  if (ring.at >= endMs) return false;
  if (ring.at < windDownAt) return true;
  return ring.kind === 'slot' || ring.kind === 'follow';
}

function windowedRemind(
  input: CountHabitRemindInput,
  window: { start: Date; end: Date },
  day: string,
  seq: number,
  done: number,
): CountHabitRemind | null {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  const slice = (endMs - startMs) / input.targetCount;
  const slots = Array.from({ length: input.targetCount }, (_, i) =>
    Math.round(startMs + i * slice),
  );
  const planned = slots[seq - 1] ?? startMs;
  const last = input.lastCompletedAt?.getTime() ?? null;
  const behind = last !== null && last >= planned;
  const rings = behind
    ? reflowRings(
        Math.round(last + paceMs(endMs - last, input.targetCount - done, slice)),
        slice,
        endMs,
        input.targetCount,
      )
    : gridRings(slots, seq - 1, endMs);
  const windDownAt = endMs - COUNT_HABIT_WIND_DOWN_MS;
  const nowMs = input.now.getTime();

  for (const ring of rings) {
    if (!visibleInWindow(ring, windDownAt, endMs)) continue;
    const scheduled = deliverableAt(new Date(ring.at), input, day);
    if (!scheduled || scheduled.getTime() >= endMs) continue;
    if (scheduled.getTime() < nowMs - MISSED_GRACE_MS) continue;
    return {
      occurrenceAt: new Date(ring.at),
      scheduledAt: scheduled,
      done,
      total: input.targetCount,
    };
  }
  return null;
}

export function countHabitRemindMessage(done: number, total: number): string {
  return `今天 ${String(done)}/${String(total)}`;
}
