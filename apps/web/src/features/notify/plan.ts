import type { NotificationPrefs, Task } from '@vital/dto';
import { formatYmd, isOpen, zonedWallTimeIso } from '@/features/todos/model';

export type NotifyEventType = 'task.remind' | 'task.due';

export type NotifyPlan = {
  eventType: NotifyEventType;
  scheduledAt: Date;
  occurrenceAt: Date;
};

const MISSED_GRACE_MS = 15 * 60 * 1000;

function dueAnchor(task: Task, allDayNotifyTime: string): Date | null {
  if (!task.dueAt) return null;
  if (!task.isAllDay) return new Date(task.dueAt);
  const ymd = formatYmd(new Date(task.dueAt), task.timezone);
  const clock = allDayNotifyTime.length === 5 ? `${allDayNotifyTime}:00` : allDayNotifyTime;
  return new Date(zonedWallTimeIso(ymd, clock, task.timezone));
}

function semanticReminderAt(task: Task, allDayNotifyTime: string): Date | null {
  switch (task.reminderMode) {
    case 'none':
      return null;
    case 'due':
      return dueAnchor(task, allDayNotifyTime);
    case 'offset': {
      const anchor = dueAnchor(task, allDayNotifyTime);
      return anchor && task.reminderOffsetMinutes
        ? new Date(anchor.getTime() - task.reminderOffsetMinutes * 60_000)
        : null;
    }
    case 'custom':
      return task.reminderAt ? new Date(task.reminderAt) : null;
    default:
      return null;
  }
}

function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const hour = Number(parts.find((item) => item.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((item) => item.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

export function isInQuietHours(
  now: Date,
  start: string | null,
  end: string | null,
  timeZone: string,
): boolean {
  if (start === null || end === null || start === end) return false;
  const t = localMinutes(now, timeZone);
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (s < e) return t >= s && t < e;
  return t >= s || t < e;
}

export function notifyKey(eventType: NotifyEventType, taskId: string, occurrenceAt: Date): string {
  return `${eventType}:${taskId}:${occurrenceAt.toISOString()}`;
}

/** Client-side mirror of server `planTaskNotification` for in-tab browser alerts. */
export function planTaskBrowserNotify(
  task: Task,
  prefs: Pick<NotificationPrefs, 'taskRemind' | 'taskDue' | 'allDayNotifyTime'>,
  now = new Date(),
): NotifyPlan | null {
  if (task.deletedAt !== null) return null;
  if (!isOpen(task)) return null;

  const remindAt = semanticReminderAt(task, prefs.allDayNotifyTime);
  if (remindAt && prefs.taskRemind) {
    if (remindAt.getTime() < now.getTime() - MISSED_GRACE_MS) return null;
    return {
      eventType: 'task.remind',
      scheduledAt: remindAt,
      occurrenceAt: task.dueAt ? new Date(task.dueAt) : remindAt,
    };
  }

  if (!task.dueAt || !prefs.taskDue) return null;
  const dueAt = new Date(task.dueAt);

  if (task.isAllDay) {
    const dueDay = formatYmd(dueAt, task.timezone);
    const today = formatYmd(now, task.timezone);
    if (dueDay < today) return null;
    const clock = prefs.allDayNotifyTime.length === 5 ? `${prefs.allDayNotifyTime}:00` : prefs.allDayNotifyTime;
    let fire = new Date(zonedWallTimeIso(dueDay, clock, task.timezone));
    if (fire.getTime() < now.getTime()) fire = now;
    return { eventType: 'task.due', scheduledAt: fire, occurrenceAt: dueAt };
  }

  if (dueAt.getTime() < now.getTime() - MISSED_GRACE_MS) return null;
  return { eventType: 'task.due', scheduledAt: dueAt, occurrenceAt: dueAt };
}

export function planDueNow(
  task: Task,
  prefs: NotificationPrefs,
  userTimeZone: string,
  now = new Date(),
): NotifyPlan | null {
  const plan = planTaskBrowserNotify(task, prefs, now);
  if (!plan) return null;
  if (isInQuietHours(now, prefs.quietHoursStart, prefs.quietHoursEnd, userTimeZone)) return null;
  if (plan.scheduledAt.getTime() > now.getTime() + 2_000) return null;
  if (now.getTime() - plan.scheduledAt.getTime() > MISSED_GRACE_MS) return null;
  return plan;
}
