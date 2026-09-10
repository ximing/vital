import { describe, expect, it } from 'vitest';
import type { Task } from '@vital/dto';
import { isOverdue, localDateStamp, startOfLocalDayIso } from '../../src/lib/format';

function sample(over: Partial<Task> & Pick<Task, 'dueAt' | 'timezone'>): Task {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    listId: '22222222-2222-4222-8222-222222222222',
    parentId: null,
    outcomeId: null,
    estimateMinutes: null,
    deferCount: 0,
    delegable: false,
    habitId: null,
    habitSeq: null,
    title: 't',
    notes: '',
    status: 'todo',
    priority: 2,
    pinned: false,
    startAt: null,
    reminderMode: null,
    reminderOffsetMinutes: null,
    reminderAt: null,
    isAllDay: true,
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

describe('isOverdue / startOfLocalDayIso', () => {
  it('all-day due today at 15:00 local is not overdue', () => {
    const tz = 'America/Los_Angeles';
    const now = new Date('2026-09-06T22:00:00.000Z');
    const dueAt = startOfLocalDayIso(tz, now);
    expect(localDateStamp(tz, now)).toBe('2026-09-06');
    expect(localDateStamp(tz, new Date(dueAt))).toBe('2026-09-06');
    expect(isOverdue(sample({ dueAt, timezone: tz, isAllDay: true }), now)).toBe(false);
  });

  it('Asia/Shanghai create-today local-date equals today (not UTC midnight)', () => {
    const tz = 'Asia/Shanghai';
    const now = new Date('2026-09-06T10:00:00.000Z');
    const dueAt = startOfLocalDayIso(tz, now);
    expect(localDateStamp(tz, now)).toBe('2026-09-06');
    expect(localDateStamp(tz, new Date(dueAt))).toBe('2026-09-06');
    expect(dueAt).toBe('2026-09-05T16:00:00.000Z');
    expect(isOverdue(sample({ dueAt, timezone: tz }), now)).toBe(false);
  });

  it('America/Los_Angeles evening create stays on that local date', () => {
    const tz = 'America/Los_Angeles';
    const now = new Date('2026-09-07T02:00:00.000Z');
    const dueAt = startOfLocalDayIso(tz, now);
    expect(localDateStamp(tz, now)).toBe('2026-09-06');
    expect(localDateStamp(tz, new Date(dueAt))).toBe('2026-09-06');
    expect(dueAt).toBe('2026-09-06T07:00:00.000Z');
    expect(isOverdue(sample({ dueAt, timezone: tz }), now)).toBe(false);
  });

  it('America/Los_Angeles DST spring-forward midnight is still that local date', () => {
    const tz = 'America/Los_Angeles';
    const now = new Date('2026-03-08T20:00:00.000Z');
    const dueAt = startOfLocalDayIso(tz, now);
    expect(localDateStamp(tz, now)).toBe('2026-03-08');
    expect(localDateStamp(tz, new Date(dueAt))).toBe('2026-03-08');
    expect(isOverdue(sample({ dueAt, timezone: tz }), now)).toBe(false);
  });

  it('yesterday local date is overdue', () => {
    const tz = 'Asia/Shanghai';
    const now = new Date('2026-09-06T10:00:00.000Z');
    const dueAt = startOfLocalDayIso(tz, new Date('2026-09-05T10:00:00.000Z'));
    expect(isOverdue(sample({ dueAt, timezone: tz }), now)).toBe(true);
  });
});
