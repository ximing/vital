import type { NotificationPrefs } from '@vital/dto';
import { DateTime } from 'luxon';
import { applyQuietHours, parseHHmm } from './quiet-hours.js';

export type TaskScheduleInput = {
  status: string;
  deletedAt: Date | null;
  dueAt: Date | null;
  remindAt: Date | null;
  reminderMode?: string | null;
  reminderOffsetMinutes?: number | null;
  reminderAt?: Date | null;
  isAllDay: boolean;
  timezone: string;
};

export type SchedulePlan = {
  eventType: 'task.remind' | 'task.due';
  scheduledAt: Date;
  occurrenceAt: Date;
};

const MISSED_GRACE_MS = 15 * 60 * 1000;

function semanticReminderAt(task: TaskScheduleInput): Date | null {
  switch (task.reminderMode) {
    case 'none':
      return null;
    case 'due':
      return task.dueAt;
    case 'offset':
      return task.dueAt && task.reminderOffsetMinutes
        ? new Date(task.dueAt.getTime() - task.reminderOffsetMinutes * 60_000)
        : null;
    case 'custom':
      return task.reminderAt ?? null;
    default:
      return task.remindAt;
  }
}

export function planTaskNotification(
  task: TaskScheduleInput,
  prefs: Pick<NotificationPrefs, 'taskRemind' | 'taskDue' | 'allDayNotifyTime'>,
  now: Date,
): SchedulePlan | null {
  if (task.deletedAt !== null) return null;
  if (task.status !== 'todo' && task.status !== 'doing') return null;

  const remindAt = semanticReminderAt(task);
  if (remindAt && prefs.taskRemind) {
    if (remindAt.getTime() < now.getTime() - MISSED_GRACE_MS) return null;
    return {
      eventType: 'task.remind',
      scheduledAt: remindAt,
      occurrenceAt: task.dueAt ?? remindAt,
    };
  }

  if (!task.dueAt || !prefs.taskDue) return null;

  if (task.isAllDay) {
    const zone = task.timezone;
    const dueLocal = DateTime.fromJSDate(task.dueAt, { zone }).startOf('day');
    const today = DateTime.fromJSDate(now, { zone }).startOf('day');
    if (dueLocal < today) return null;
    const { hour, minute } = parseHHmm(prefs.allDayNotifyTime);
    let fire = dueLocal.set({ hour, minute, second: 0, millisecond: 0 });
    if (fire.toJSDate().getTime() < now.getTime()) fire = DateTime.fromJSDate(now);
    return {
      eventType: 'task.due',
      scheduledAt: fire.toJSDate(),
      occurrenceAt: task.dueAt,
    };
  }

  if (task.dueAt.getTime() < now.getTime() - MISSED_GRACE_MS) return null;
  return {
    eventType: 'task.due',
    scheduledAt: task.dueAt,
    occurrenceAt: task.dueAt,
  };
}

export function planWithQuietHours(
  task: TaskScheduleInput,
  prefs: NotificationPrefs,
  userTimeZone: string,
  now: Date,
): SchedulePlan | null {
  const plan = planTaskNotification(task, prefs, now);
  if (!plan) return null;
  return {
    ...plan,
    scheduledAt: applyQuietHours(
      plan.scheduledAt,
      prefs.quietHoursStart,
      prefs.quietHoursEnd,
      userTimeZone,
    ),
  };
}

export function idempotencyKey(eventType: string, taskId: string, occurrenceAt: Date): string {
  return `${eventType}:${taskId}:${occurrenceAt.toISOString()}`;
}
