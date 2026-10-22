import { DateTime } from 'luxon';
import type {
  CreateTaskInput,
  PatchTaskInput,
  RecurrenceKind,
  ReminderMode,
  ReminderOffsetMinutes,
  TaskStatus,
} from '@vital/dto';
import type { TaskRow } from '../db/schema.js';
import { AppError } from '../errors.js';
import {
  allDayLocalMidnight,
  nextFixedOccurrenceAfter,
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
  parseRrule,
} from './recurrence.js';
import { asRecurrenceKind, asReminderMode, asReminderOffsetMinutes } from './task-dto.js';
import { toRecurrence } from './tasks.shared.js';

export function isRecurring(row: TaskRow): boolean {
  return row.recurrenceRrule !== null || asRecurrenceKind(row.recurrenceKind) !== null;
}

export function parseInstant(isoStr: string, allDay: boolean, zone: string): Date {
  if (allDay) return allDayLocalMidnight(isoStr, zone);
  const dt = DateTime.fromISO(isoStr);
  if (!dt.isValid) throw AppError.of(400, 'VALIDATION_ERROR');
  return dt.toJSDate();
}

export function dueAtFromYmd(ymd: string, zone: string): Date {
  const dt = DateTime.fromISO(`${ymd}T00:00:00`, { zone });
  if (!dt.isValid) throw AppError.of(400, 'VALIDATION_ERROR');
  return dt.toJSDate();
}

export function snapExisting(d: Date | null, allDay: boolean, zone: string): Date | null {
  if (d === null) return null;
  if (!allDay) return d;
  return DateTime.fromJSDate(d, { zone }).startOf('day').toJSDate();
}

export function shiftBy(d: Date | null, deltaMs: number): Date | null {
  if (d === null) return null;
  return new Date(d.getTime() + deltaMs);
}

export interface TaskScheduleFields {
  isAllDay: boolean;
  dueAt: Date | null;
  startAt: Date | null;
  reminderMode: ReminderMode | null;
  reminderOffsetMinutes: ReminderOffsetMinutes | null;
  reminderAt: Date | null;
  recurrence: string | null;
  recurrenceDtstart: Date | null;
  recurrenceKind: RecurrenceKind | null;
}

/** Reminder and recurrence fields for a new task. No database access. */
export function resolveCreateSchedule(input: CreateTaskInput, zone: string): TaskScheduleFields {
  const isAllDay =
    input.dueYmd !== undefined ? (input.isAllDay ?? true) : (input.isAllDay ?? false);
  const dueAt =
    input.dueYmd !== undefined
      ? dueAtFromYmd(input.dueYmd, zone)
      : input.dueAt === undefined || input.dueAt === null
        ? null
        : parseInstant(input.dueAt, isAllDay, zone);
  const startAt =
    input.startAt === undefined || input.startAt === null
      ? null
      : parseInstant(input.startAt, isAllDay, zone);

  const reminderMode = input.reminderMode ?? null;
  const reminderOffsetMinutes =
    reminderMode === 'offset' ? (input.reminderOffsetMinutes ?? null) : null;
  const reminderAt =
    reminderMode === 'custom' && input.reminderAt !== null && input.reminderAt !== undefined
      ? parseInstant(input.reminderAt, false, zone)
      : null;
  if ((reminderMode === 'due' || reminderMode === 'offset') && dueAt === null) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (
    (reminderMode === 'offset' && reminderOffsetMinutes === null) ||
    (reminderMode === 'custom' && reminderAt === null)
  ) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }

  let recurrence: string | null = null;
  let recurrenceDtstart: Date | null = null;
  if (input.recurrence !== undefined && input.recurrence !== null) {
    if (dueAt === null) throw AppError.of(400, 'RRULE_DUE_REQUIRED');
    parseRrule(input.recurrence);
    recurrence = input.recurrence;
    recurrenceDtstart = dueAt;
  }
  const recurrenceKind = input.recurrenceKind ?? null;
  if (recurrenceKind !== null && (dueAt === null || input.recurrence !== undefined)) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }

  return {
    isAllDay,
    dueAt,
    startAt,
    reminderMode,
    reminderOffsetMinutes,
    reminderAt,
    recurrence,
    recurrenceDtstart,
    recurrenceKind,
  };
}

export interface PatchSchedule extends TaskScheduleFields {
  zone: string;
  dueTouched: boolean;
  scheduleTouched: boolean;
  oldDue: Date | null;
}

/**
 * Schedule columns a patch would write. Snaps an existing rule onto the new due
 * instant. Does not touch the row.
 */
export function resolvePatchSchedule(task: TaskRow, input: PatchTaskInput): PatchSchedule {
  const zone = input.timezone ?? task.timezone;
  const isAllDay =
    input.dueYmd !== undefined ? (input.isAllDay ?? true) : (input.isAllDay ?? task.isAllDay);

  let dueAt = task.dueAt;
  let startAt = task.startAt;
  let reminderMode = asReminderMode(task.reminderMode);
  let reminderOffsetMinutes = asReminderOffsetMinutes(task.reminderOffsetMinutes);
  let reminderAt = task.reminderAt;
  const dueTouched = input.dueAt !== undefined || input.dueYmd !== undefined;
  if (input.dueYmd !== undefined) {
    dueAt = dueAtFromYmd(input.dueYmd, zone);
  } else if (input.dueAt !== undefined) {
    dueAt = input.dueAt === null ? null : parseInstant(input.dueAt, isAllDay, zone);
  } else if (input.isAllDay !== undefined || input.timezone !== undefined) {
    dueAt = snapExisting(dueAt, isAllDay, zone);
  }
  if (input.startAt !== undefined) {
    startAt = input.startAt === null ? null : parseInstant(input.startAt, isAllDay, zone);
  } else if (input.isAllDay !== undefined || input.timezone !== undefined) {
    startAt = snapExisting(startAt, isAllDay, zone);
  }

  if (input.reminderMode !== undefined) {
    reminderMode = input.reminderMode;
    if (reminderMode === null || reminderMode === 'none' || reminderMode === 'due') {
      reminderOffsetMinutes = null;
      reminderAt = null;
    }
    if (reminderMode === 'offset') {
      reminderOffsetMinutes = input.reminderOffsetMinutes ?? null;
      reminderAt = null;
    }
    if (reminderMode === 'custom') {
      reminderOffsetMinutes = null;
      reminderAt =
        input.reminderAt === null || input.reminderAt === undefined
          ? null
          : parseInstant(input.reminderAt, false, zone);
    }
  } else if (input.reminderOffsetMinutes !== undefined || input.reminderAt !== undefined) {
    if (reminderMode === 'offset' && input.reminderOffsetMinutes !== undefined) {
      reminderOffsetMinutes = input.reminderOffsetMinutes;
    } else if (reminderMode === 'custom' && input.reminderAt !== undefined) {
      reminderAt = input.reminderAt === null ? null : parseInstant(input.reminderAt, false, zone);
    } else {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
  }
  if ((reminderMode === 'due' || reminderMode === 'offset') && dueAt === null) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (
    (reminderMode === 'offset' && reminderOffsetMinutes === null) ||
    (reminderMode === 'custom' && reminderAt === null)
  ) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }

  let recurrence = task.recurrenceRrule;
  let recurrenceDtstart = task.recurrenceDtstart;
  let recurrenceKind = asRecurrenceKind(task.recurrenceKind);
  if (input.recurrence !== undefined && input.recurrenceKind !== undefined) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  if (input.recurrence !== undefined) {
    if (input.recurrence === null) {
      recurrence = null;
      recurrenceDtstart = null;
    } else {
      if (dueAt === null) throw AppError.of(400, 'RRULE_DUE_REQUIRED');
      parseRrule(input.recurrence);
      recurrence = input.recurrence;
      if (task.recurrenceDtstart === null) recurrenceDtstart = dueAt;
    }
  } else if (recurrence && dueAt === null) {
    throw AppError.of(400, 'RRULE_DUE_REQUIRED');
  }
  if (input.recurrenceKind !== undefined) {
    recurrenceKind = input.recurrenceKind;
    recurrence = null;
    recurrenceDtstart = recurrenceKind === null ? null : dueAt;
  }
  if (recurrenceKind !== null && dueAt === null) throw AppError.of(400, 'VALIDATION_ERROR');

  const oldDue = task.dueAt;
  if (dueTouched && recurrence && dueAt) {
    const snapped = nextOccurrenceOnOrAfter(
      {
        ...toRecurrence(task),
        recurrenceRrule: recurrence,
        recurrenceDtstart,
        isAllDay,
        timezone: zone,
        dueAt,
      },
      dueAt,
    );
    if (snapped === null) throw AppError.of(400, 'RRULE_INVALID');
    if (oldDue) {
      const delta = snapped.getTime() - oldDue.getTime();
      startAt = shiftBy(startAt, delta);
      reminderAt = shiftBy(reminderAt, delta);
    }
    dueAt = snapped;
  }

  const scheduleTouched =
    dueTouched ||
    input.startAt !== undefined ||
    input.isAllDay !== undefined ||
    input.timezone !== undefined ||
    input.reminderMode !== undefined ||
    input.reminderOffsetMinutes !== undefined ||
    input.reminderAt !== undefined ||
    input.recurrence !== undefined ||
    input.recurrenceKind !== undefined;

  return {
    zone,
    isAllDay,
    dueAt,
    startAt,
    reminderMode,
    reminderOffsetMinutes,
    reminderAt,
    recurrence,
    recurrenceDtstart,
    recurrenceKind,
    dueTouched,
    scheduleTouched,
    oldDue,
  };
}

/** Next open occurrence when a recurring task is completed. One-shot tasks stay done. */
export async function rollCompletionSchedule(
  task: TaskRow,
  now: Date,
): Promise<{
  nextDue: Date | null;
  nextStart: Date | null;
  nextReminderAt: Date | null;
  nextStatus: TaskStatus;
  completedAt: Date | null;
}> {
  let nextDue = task.dueAt;
  let nextStart = task.startAt;
  let nextReminderAt = task.reminderAt;
  let nextStatus: TaskStatus = 'done';
  let completedAt: Date | null = now;

  if (task.recurrenceRrule && task.dueAt) {
    const nxt = nextOccurrenceAfter(toRecurrence(task), task.dueAt);
    if (nxt) {
      const delta = nxt.getTime() - task.dueAt.getTime();
      nextDue = nxt;
      nextStart = shiftBy(task.startAt, delta);
      nextReminderAt = shiftBy(task.reminderAt, delta);
      nextStatus = 'todo';
      completedAt = null;
    }
  }
  const recurrenceKind = asRecurrenceKind(task.recurrenceKind);
  if (recurrenceKind && task.dueAt) {
    const nxt = await nextFixedOccurrenceAfter(
      {
        dueAt: task.dueAt,
        timezone: task.timezone,
        isAllDay: task.isAllDay,
        recurrenceKind,
      },
      task.dueAt,
    );
    if (nxt) {
      const delta = nxt.getTime() - task.dueAt.getTime();
      nextDue = nxt;
      nextStart = shiftBy(task.startAt, delta);
      nextReminderAt = shiftBy(task.reminderAt, delta);
      nextStatus = 'todo';
      completedAt = null;
    }
  }

  return { nextDue, nextStart, nextReminderAt, nextStatus, completedAt };
}
