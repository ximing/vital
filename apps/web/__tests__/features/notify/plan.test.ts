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
