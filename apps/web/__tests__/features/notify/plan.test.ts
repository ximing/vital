import { DEFAULT_NOTIFICATION_PREFS, type Task } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import { notifyKey, planDueNow, planTaskBrowserNotify } from '../../../src/features/notify/plan';

const TZ = 'Asia/Shanghai';

function task(over: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    listId: 'inbox-1',
    parentId: null,
    outcomeId: null,
    estimateMinutes: null,
    deferCount: 0,
    delegable: false,
    habitId: null,
    habitSeq: null,
    title: '交报告',
    notes: '',
    status: 'todo',
    priority: 3,
    pinned: false,
    dueAt: '2026-09-13T04:00:00.000Z',
    startAt: null,
    reminderMode: 'due',
    reminderOffsetMinutes: null,
    reminderAt: null,
    isAllDay: false,
    timezone: TZ,
    recurrence: null,
    recurrenceKind: null,
    recurrenceDtstart: null,
    completedAt: null,
    sortOrder: 1,
    tagIds: [],
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('planTaskBrowserNotify', () => {
  it('fires a due reminder at dueAt when reminderMode is due', () => {
    const due = new Date('2026-09-13T04:00:00.000Z');
    const plan = planTaskBrowserNotify(task({ id: 't1' }), DEFAULT_NOTIFICATION_PREFS, due);
    expect(plan?.eventType).toBe('task.remind');
    expect(plan?.scheduledAt.toISOString()).toBe(due.toISOString());
  });

  it('keeps a paced count-habit reminder off the immediate all-day due path', () => {
    const dueAt = '2026-09-06T00:00:00.000Z';
    const now = new Date('2026-09-06T00:30:00.000Z');
    const slot = '2026-09-06T01:45:00.000Z';
    const paced = planTaskBrowserNotify(
      task({
        id: 'habit-task',
        habitId: 'habit-1',
        habitSeq: 2,
        isAllDay: true,
        dueAt,
        reminderMode: 'custom',
        reminderAt: slot,
      }),
      DEFAULT_NOTIFICATION_PREFS,
      now,
    );
    expect(paced?.eventType).toBe('task.remind');
    expect(paced?.scheduledAt.toISOString()).toBe(slot);
    expect(paced?.occurrenceAt.toISOString()).toBe(slot);

    expect(
      planTaskBrowserNotify(
        task({
          id: 'quiet',
          habitId: 'habit-1',
          isAllDay: true,
          dueAt,
          reminderMode: 'custom',
          reminderAt: null,
        }),
        DEFAULT_NOTIFICATION_PREFS,
        now,
      ),
    ).toBeNull();

    const daily = planTaskBrowserNotify(
      task({ id: 'daily', habitId: 'habit-1', isAllDay: true, dueAt, reminderMode: null }),
      DEFAULT_NOTIFICATION_PREFS,
      new Date('2026-09-06T08:00:00.000Z'),
    );
    expect(daily?.eventType).toBe('task.due');
    expect(daily?.scheduledAt.toISOString()).toBe('2026-09-06T08:00:00.000Z');
  });

  it('does not plan completed tasks', () => {
    expect(
      planTaskBrowserNotify(
        task({ id: 't1', status: 'done' }),
        DEFAULT_NOTIFICATION_PREFS,
        new Date('2026-09-13T04:00:00.000Z'),
      ),
    ).toBeNull();
  });
});

describe('planDueNow', () => {
  it('returns the plan once the fire time has arrived', () => {
    const due = new Date('2026-09-13T04:00:00.000Z');
    const plan = planDueNow(task({ id: 't1' }), DEFAULT_NOTIFICATION_PREFS, TZ, due);
    expect(plan?.eventType).toBe('task.remind');
    expect(notifyKey(plan!.eventType, 't1', plan!.occurrenceAt)).toContain('task.remind:t1:');
  });

  it('skips future fire times', () => {
    const due = new Date('2026-09-13T04:00:00.000Z');
    expect(
      planDueNow(task({ id: 't1' }), DEFAULT_NOTIFICATION_PREFS, TZ, new Date(due.getTime() - 60_000)),
    ).toBeNull();
  });
});
