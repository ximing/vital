import type {
  RecurrenceKind,
  ReminderMode,
  ReminderOffsetMinutes,
  Task,
  TaskPriority,
  TaskStatus,
} from '@vital/dto';
import type { TaskRow } from '../db/schema.js';

export function asStatus(value: string): TaskStatus {
  if (value === 'todo' || value === 'doing' || value === 'done' || value === 'canceled') {
    return value;
  }
  return 'todo';
}

export function asPriority(value: number): TaskPriority {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  return 3;
}

export function asReminderMode(value: string | null): ReminderMode | null {
  return value === 'none' || value === 'due' || value === 'offset' || value === 'custom' ? value : null;
}

export function asReminderOffsetMinutes(value: number | null): ReminderOffsetMinutes | null {
  return value === 5 || value === 15 || value === 30 || value === 60 || value === 1440 ? value : null;
}

export function asRecurrenceKind(value: string | null): RecurrenceKind | null {
  return value === 'daily' ||
    value === 'weekly' ||
    value === 'monthly' ||
    value === 'yearly' ||
    value === 'weekdays' ||
    value === 'weekends' ||
    value === 'holidays' ||
    value === 'legal_workdays'
    ? value
    : null;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export function toTaskDto(row: TaskRow, tagIds: string[]): Task {
  return {
    id: row.id,
    listId: row.listId,
    parentId: row.parentId,
    outcomeId: row.outcomeId,
    title: row.title,
    notes: row.notesMd,
    status: asStatus(row.status),
    priority: asPriority(row.priority),
    pinned: row.pinned,
    estimateMinutes: row.estimateMinutes,
    deferCount: row.deferCount,
    habitId: row.habitId,
    habitSeq: row.habitSeq,
    dueAt: iso(row.dueAt),
    startAt: iso(row.startAt),
    reminderMode: asReminderMode(row.reminderMode),
    reminderOffsetMinutes: asReminderOffsetMinutes(row.reminderOffsetMinutes),
    reminderAt: iso(row.reminderAt),
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    recurrence: row.recurrenceRrule,
    recurrenceKind: asRecurrenceKind(row.recurrenceKind),
    recurrenceDtstart: iso(row.recurrenceDtstart),
    completedAt: iso(row.completedAt),
    sortOrder: row.sortOrder,
    tagIds,
    deletedAt: iso(row.deletedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
