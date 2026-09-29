import type { PatchTaskInput, RecurrenceKind, ReminderOffsetMinutes, Task } from '@vital/dto';
import { copy } from './copy';
import {
  formatHm,
  formatHumanDay,
  fromDatetimeLocal,
  isOverdue,
  localDateStamp,
  zonedLocalMidnightIso,
} from './format';

export type ReminderValue = 'none' | 'due' | 'custom' | '5' | '15' | '30' | '60' | '1440';
export type RecurrenceValue = RecurrenceKind | 'none' | 'custom';

function rruleInterval(rrule: string): number {
  const match = /(?:^|;)INTERVAL=(\d+)(?:;|$)/i.exec(rrule.replace(/^RRULE:/i, ''));
  if (match?.[1] === undefined) return 1;
  const n = Number(match[1]);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** 「每 2 个月」 for a plain FREQ + INTERVAL>1 rule. Complex rules stay unlabeled. */
export function intervalRecurrenceLabel(rrule: string | null): string | null {
  if (rrule === null || rrule === '') return null;
  const interval = rruleInterval(rrule);
  if (interval <= 1) return null;
  if (/\b(?:BYDAY|BYMONTHDAY|COUNT|UNTIL)=/i.test(rrule)) return null;
  const freq = /\bFREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)\b/i.exec(rrule)?.[1]?.toUpperCase();
  if (freq === 'DAILY') return `每 ${interval} 天`;
  if (freq === 'WEEKLY') return `每 ${interval} 周`;
  if (freq === 'MONTHLY') return `每 ${interval} 个月`;
  if (freq === 'YEARLY') return `每 ${interval} 年`;
  return null;
}

export function recurrenceKind(
  rrule: string | null,
): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' {
  if (rrule === null || rrule === '') return 'none';
  if (rruleInterval(rrule) > 1) return 'custom';
  if (/\bFREQ=DAILY\b/.test(rrule) && !/\bBYDAY=/.test(rrule)) return 'daily';
  if (/\bFREQ=WEEKLY\b/.test(rrule) && !/\bBYDAY=/.test(rrule)) return 'weekly';
  if (/\bFREQ=MONTHLY\b/.test(rrule)) return 'monthly';
  if (/\bFREQ=YEARLY\b/.test(rrule)) return 'yearly';
  return 'custom';
}

export function reminderSelectValue(task: Task): ReminderValue {
  const mode = task.reminderMode ?? 'none';
  if (mode === 'offset') {
    const minutes = task.reminderOffsetMinutes ?? 15;
    return String(minutes) as ReminderValue;
  }
  return mode;
}

export function recurrenceSelectValue(task: Task): RecurrenceValue {
  if (task.recurrenceKind) return task.recurrenceKind;
  return recurrenceKind(task.recurrence);
}

/** Point-date patch for one day, keeping the task's time-of-day when it has one. */
export function scheduleDayPatch(task: Task, ymd: string, zone: string): PatchTaskInput {
  if (task.isAllDay || task.dueAt === null) {
    return { startAt: null, dueAt: zonedLocalMidnightIso(zone, ymd), isAllDay: true };
  }
  return {
    startAt: null,
    dueAt: fromDatetimeLocal(`${ymd}T${formatHm(task.dueAt, zone)}`, zone),
    isAllDay: false,
  };
}

export function offsetLabel(minutes: ReminderOffsetMinutes): string {
  if (minutes === 5) return copy.todos.reminder5m;
  if (minutes === 15) return copy.todos.reminder15m;
  if (minutes === 30) return copy.todos.reminder30m;
  if (minutes === 60) return copy.todos.reminder1h;
  return copy.todos.reminder1d;
}

export function dueMeta(task: Task, timeZone: string, now = new Date()): string | null {
  if (task.dueAt === null && task.startAt === null) return null;
  const iso = task.dueAt ?? task.startAt;
  if (iso === null) return null;
  const ymd = localDateStamp(timeZone, new Date(iso));
  const day = formatHumanDay(ymd, timeZone, now);
  if (task.isAllDay) return isOverdue(task, now) ? `逾期 · ${day}` : day;
  const clock = formatHm(iso, timeZone);
  return isOverdue(task, now) ? `逾期 · ${day} ${clock}` : `${day} ${clock}`;
}

export function recurrenceMeta(task: Task): string | null {
  if (task.recurrenceKind === null) {
    const interval = intervalRecurrenceLabel(task.recurrence);
    if (interval !== null) return interval;
  }
  const kind = recurrenceSelectValue(task);
  if (kind === 'none') return null;
  if (kind === 'daily') return copy.todos.recurrenceDaily;
  if (kind === 'weekly') return copy.todos.recurrenceWeekly;
  if (kind === 'monthly') return copy.todos.recurrenceMonthly;
  if (kind === 'yearly') return copy.todos.recurrenceYearly;
  if (kind === 'weekdays') return copy.todos.recurrenceWeekdays;
  if (kind === 'weekends') return copy.todos.recurrenceWeekends;
  if (kind === 'holidays') return copy.todos.recurrenceHolidays;
  if (kind === 'legal_workdays') return copy.todos.recurrenceLegalWorkdays;
  return copy.todos.recurrence;
}

export function reminderMeta(task: Task, timeZone: string): string | null {
  const mode = task.reminderMode ?? 'none';
  if (mode === 'none') return null;
  if (mode === 'due') return copy.todos.reminderDue;
  if (mode === 'offset') {
    return offsetLabel(task.reminderOffsetMinutes ?? 15);
  }
  if (task.reminderAt) return `${copy.todos.remind} ${formatHm(task.reminderAt, timeZone)}`;
  return copy.todos.remind;
}

export function isDueSoon(task: Task, now = new Date()): boolean {
  if (task.dueAt === null) return false;
  if (task.status === 'done' || task.status === 'canceled') return false;
  if (isOverdue(task, now)) return false;
  return localDateStamp(task.timezone, new Date(task.dueAt)) === localDateStamp(task.timezone, now);
}
