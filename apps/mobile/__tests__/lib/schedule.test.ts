import { describe, expect, it } from 'vitest';
import type { Task } from '@vital/dto';
import { copy } from '../../src/lib/copy';
import { fromDatetimeLocal, startOfLocalDayIso, toDatetimeLocal } from '../../src/lib/format';
import {
  dueMeta,
  recurrenceMeta,
  recurrenceSelectValue,
  reminderMeta,
  reminderSelectValue,
} from '../../src/lib/schedule';

const TZ = 'Asia/Shanghai';

function sample(over: Partial<Task> = {}): Task {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    listId: '22222222-2222-4222-8222-222222222222',
    parentId: null,
    title: '发送周报',
    notes: '',
    status: 'todo',
    priority: 3,
    dueAt: '2026-09-08T01:00:00.000Z',
    startAt: null,
    reminderMode: null,
    reminderOffsetMinutes: null,
    reminderAt: null,
    isAllDay: false,
    timezone: TZ,
    recurrence: null,
    recurrenceKind: null,
    recurrenceDtstart: null,
    completedAt: null,
    sortOrder: 0,
    tagIds: [],
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('schedule semantic fields', () => {
  it('maps reminder offsets and fixed recurrence kinds', () => {
    const task = sample({
      reminderMode: 'offset',
      reminderOffsetMinutes: 15,
      recurrenceKind: 'legal_workdays',
    });
    expect(reminderSelectValue(task)).toBe('15');
    expect(recurrenceSelectValue(task)).toBe('legal_workdays');
    expect(reminderMeta(task, TZ)).toBe(copy.todos.reminder15m);
    expect(recurrenceMeta(task)).toBe(copy.todos.recurrenceLegalWorkdays);
  });

  it('falls back from an rrule when recurrenceKind is absent', () => {
    expect(recurrenceSelectValue(sample({ recurrence: 'FREQ=WEEKLY' }))).toBe('weekly');
    expect(reminderSelectValue(sample({ reminderMode: 'custom' }))).toBe('custom');
  });

  it('shows due meta with today and overdue labels', () => {
    const now = new Date('2026-09-08T04:00:00.000Z');
    expect(dueMeta(sample({ isAllDay: true, dueAt: startOfLocalDayIso(TZ, now) }), TZ, now)).toBe('今天');
    expect(
      dueMeta(
        sample({ isAllDay: true, dueAt: startOfLocalDayIso(TZ, new Date('2026-09-07T04:00:00.000Z')) }),
        TZ,
        now,
      ),
    ).toContain('逾期');
  });
});

describe('datetime local round-trip', () => {
  it('converts a Shanghai wall time through datetime-local', () => {
    const iso = fromDatetimeLocal('2026-09-07T09:00', TZ);
    expect(iso).toBe('2026-09-07T01:00:00.000Z');
    expect(toDatetimeLocal(iso, TZ)).toBe('2026-09-07T09:00');
  });
});
