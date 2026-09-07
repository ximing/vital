import { DEFAULT_NOTIFICATION_PREFS } from '@vital/dto';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { planTaskNotification, planWithQuietHours } from '../../src/notifications/schedule.js';

const TZ = 'Asia/Shanghai';

function at(iso: string): Date {
  return new Date(iso);
}

function task(over: Partial<Parameters<typeof planTaskNotification>[0]>) {
  return {
    status: 'todo',
    deletedAt: null,
    dueAt: null,
    reminderMode: null,
    reminderOffsetMinutes: null,
    reminderAt: null,
    isAllDay: false,
    timezone: TZ,
    ...over,
  };
}

describe('planTaskNotification', () => {
  const now = at('2026-09-06T10:00:00.000Z');
  const prefs = DEFAULT_NOTIFICATION_PREFS;

  it('uses a custom reminderAt when set', () => {
    const reminderAt = at('2026-09-06T12:00:00.000Z');
    const dueAt = at('2026-09-06T14:00:00.000Z');
    const plan = planTaskNotification(
      task({ reminderMode: 'custom', reminderAt, dueAt }),
      prefs,
      now,
    );
    expect(plan?.eventType).toBe('task.remind');
    expect(plan?.scheduledAt.toISOString()).toBe(reminderAt.toISOString());
    expect(plan?.occurrenceAt.toISOString()).toBe(dueAt.toISOString());
  });

  it('calculates semantic offset and custom reminders before falling back to due', () => {
    const dueAt = at('2026-09-06T14:00:00.000Z');
    const offset = planTaskNotification(
      task({ dueAt, reminderMode: 'offset', reminderOffsetMinutes: 15 }),
      prefs,
      now,
    );
    expect(offset?.eventType).toBe('task.remind');
    expect(offset?.scheduledAt.toISOString()).toBe('2026-09-06T13:45:00.000Z');

    const customAt = at('2026-09-06T12:30:00.000Z');
    const custom = planTaskNotification(
      task({ dueAt, reminderMode: 'custom', reminderAt: customAt }),
      prefs,
      now,
    );
    expect(custom?.eventType).toBe('task.remind');
    expect(custom?.scheduledAt.toISOString()).toBe(customAt.toISOString());
  });

  it('falls back to timed dueAt when no remind', () => {
    const dueAt = at('2026-09-06T14:00:00.000Z');
    const plan = planTaskNotification(task({ dueAt }), prefs, now);
    expect(plan?.eventType).toBe('task.due');
    expect(plan?.scheduledAt.toISOString()).toBe(dueAt.toISOString());
  });

  it('all-day due today fires at allDayNotifyTime, or now if that already passed', () => {
    const dueAt = DateTime.fromISO('2026-09-06', { zone: TZ }).startOf('day').toJSDate();
    const morning = DateTime.fromISO('2026-09-06T01:00:00.000Z').toJSDate(); // 09:00 CST
    const plan = planTaskNotification(task({ dueAt, isAllDay: true }), prefs, morning);
    expect(plan?.eventType).toBe('task.due');
    expect(plan).not.toBeNull();
    if (!plan) return;
    const fire = DateTime.fromJSDate(plan.scheduledAt, { zone: TZ });
    expect(fire.hour).toBe(9);
    expect(fire.minute).toBe(0);

    const afternoon = DateTime.fromISO('2026-09-06T08:00:00.000Z').toJSDate(); // 16:00 CST
    const late = planTaskNotification(task({ dueAt, isAllDay: true }), prefs, afternoon);
    expect(late?.scheduledAt.getTime()).toBe(afternoon.getTime());
  });

  it('does not enqueue past calendar all-day or missed timed due', () => {
    const yesterday = DateTime.fromISO('2026-09-05', { zone: TZ }).startOf('day').toJSDate();
    expect(
      planTaskNotification(task({ dueAt: yesterday, isAllDay: true }), prefs, now),
    ).toBeNull();
    const oldDue = at('2026-09-06T08:00:00.000Z');
    expect(planTaskNotification(task({ dueAt: oldDue }), prefs, now)).toBeNull();
  });

  it('respects event toggles and terminal status', () => {
    const dueAt = at('2026-09-06T14:00:00.000Z');
    expect(
      planTaskNotification(task({ dueAt }), { ...prefs, taskDue: false }, now),
    ).toBeNull();
    expect(planTaskNotification(task({ dueAt, status: 'done' }), prefs, now)).toBeNull();
    expect(
      planTaskNotification(task({ dueAt, deletedAt: now }), prefs, now),
    ).toBeNull();
  });

  it('applies overnight quiet hours', () => {
    const dueAt = at('2026-09-06T16:00:00.000Z'); // 00:00 CST next day
    const plan = planWithQuietHours(
      task({ dueAt }),
      { ...prefs, quietHoursStart: '23:00', quietHoursEnd: '08:00' },
      TZ,
      now,
    );
    expect(plan).not.toBeNull();
    if (!plan) return;
    const local = DateTime.fromJSDate(plan.scheduledAt, { zone: TZ });
    expect(local.hour).toBe(8);
    expect(local.minute).toBe(0);
  });
});
