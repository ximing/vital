import { DateTime } from 'luxon';
import type { OutcomeSignal } from '@vital/dto';

/** Days without any activity before a thread reads as stalled. */
export const STALE_DAYS = 14;
/** Defer count at which a task is flagged as probably too big. */
export const DEFER_THRESHOLD = 3;

function localDateOf(at: Date, tz: string): string {
  return DateTime.fromJSDate(at).setZone(tz).toISODate() ?? '';
}

/**
 * Overdue by granularity: all-day tasks read as overdue only from the next local
 * day (due today never counts, at any hour); timed tasks are overdue past their instant.
 */
export function isOverdue(
  dueAt: Date | null,
  isAllDay: boolean,
  now: Date,
  tz: string,
): boolean {
  if (dueAt === null) return false;
  if (!isAllDay) return dueAt.getTime() < now.getTime();
  return localDateOf(dueAt, tz) < localDateOf(now, tz);
}

export interface OutcomeFacts {
  completedLast7d: number;
  completedPrev7d: number;
  openCount: number;
  overdueCount: number;
  lastActivityAt: Date | null;
}

/** Deterministic momentum ladder: alert > up > flat. */
export function computeSignal(facts: OutcomeFacts, now: Date): OutcomeSignal {
  if (facts.overdueCount > 0) return 'alert';
  const last = facts.lastActivityAt;
  if (!last || now.getTime() - last.getTime() > STALE_DAYS * 24 * 3600 * 1000) {
    return facts.openCount > 0 ? 'alert' : 'flat';
  }
  if (facts.completedLast7d >= 2 || facts.completedLast7d > facts.completedPrev7d) return 'up';
  return 'flat';
}

export interface NextStepTask {
  title: string;
  status: string;
  dueAt: Date | null;
  priority: number;
  isAllDay: boolean;
}

/** Next step = nearest overdue open task, else nearest upcoming due, else highest priority. */
export function selectRuleNextStep(tasks: NextStepTask[], now: Date, tz: string): string | null {
  const open = tasks.filter((t) => t.status === 'todo' || t.status === 'doing');
  if (open.length === 0) return null;
  const overdue = open
    .filter((t) => isOverdue(t.dueAt, t.isAllDay, now, tz))
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));
  if (overdue.length > 0) return overdue[0]!.title;
  const upcoming = open
    .filter((t) => t.dueAt !== null)
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));
  if (upcoming.length > 0) return upcoming[0]!.title;
  return open.sort((a, b) => a.priority - b.priority)[0]!.title;
}

/** A defer = dueAt pushed strictly forward. null→date and same-day time changes don't count. */
export function isDefer(
  prevDueAt: Date | null,
  nextDueAt: Date | null | undefined,
  _now: Date,
): boolean {
  if (!prevDueAt || nextDueAt === null || nextDueAt === undefined) return false;
  return nextDueAt.getTime() > prevDueAt.getTime();
}

export function needsDecomposition(deferCount: number): boolean {
  return deferCount >= DEFER_THRESHOLD;
}
