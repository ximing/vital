import type { RecurrenceKind, ReminderOffsetMinutes, Task } from '@vital/dto';
import { copy } from './copy';
import { formatHm, formatHumanDay, isOverdue, localDateStamp } from './format';

export type ReminderValue = 'none' | 'due' | 'custom' | '5' | '15' | '30' | '60' | '1440';
export type RecurrenceValue = RecurrenceKind | 'none' | 'custom';

export function recurrenceKind(
  rrule: string | null,
): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' {
  if (rrule === null || rrule === '') return 'none';
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
