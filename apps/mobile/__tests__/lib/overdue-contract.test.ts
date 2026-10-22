// The three isOverdue contracts differ. This file locks the mobile side.
// Do not change these expectations to match server or web in a move-only refactor.
//
// Shared clock (same instants on server, web, and mobile):
// NOW = 2026-09-09T12:00:00.000Z
//   Asia/Shanghai       2026-09-09 20:00 (local date 2026-09-09)
//   America/Los_Angeles 2026-09-09 05:00 PDT (local date 2026-09-09)
// DUE_EARLIER_TODAY = 2026-09-08T16:00:00.000Z
//   Shanghai midnight of the 9th; Los Angeles 2026-09-08 09:00
// DUE_YESTERDAY = 2026-09-07T16:00:00.000Z
//   Shanghai midnight of the 8th; Los Angeles 2026-09-07 09:00
// DUE_TIMED_60 = 2026-09-09T11:00:00.000Z
//   60 minutes before NOW; still 2026-09-09 in both zones
// DUE_ZONE_SPLIT = 2026-09-09T04:00:00.000Z
//   Shanghai 2026-09-09 12:00; Los Angeles 2026-09-08 21:00
//
// Comparisons use task.timezone. isAllDay is ignored. Done and canceled are skipped.

import type { Task } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import { isOverdue } from '../../src/lib/format';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const SHANGHAI = 'Asia/Shanghai';
const LOS_ANGELES = 'America/Los_Angeles';
const DUE_EARLIER_TODAY = '2026-09-08T16:00:00.000Z';
const DUE_YESTERDAY = '2026-09-07T16:00:00.000Z';
const DUE_TIMED_60 = '2026-09-09T11:00:00.000Z';
const DUE_ZONE_SPLIT = '2026-09-09T04:00:00.000Z';

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

describe('isOverdue contract (mobile)', () => {
  it('is false when dueAt is null', () => {
    expect(isOverdue(sample({ dueAt: null, timezone: SHANGHAI }), NOW)).toBe(false);
  });

  it('is false for done and canceled even when the local due date is past', () => {
    // DUE_YESTERDAY is before today in Shanghai. An open todo is true below.
    const past = { dueAt: DUE_YESTERDAY, timezone: SHANGHAI, isAllDay: true };
    expect(isOverdue(sample({ ...past, status: 'done' }), NOW)).toBe(false);
    expect(isOverdue(sample({ ...past, status: 'canceled' }), NOW)).toBe(false);
  });

  it('compares local dates for an all-day due earlier today and yesterday', () => {
    expect(
      isOverdue(sample({ dueAt: DUE_EARLIER_TODAY, timezone: SHANGHAI, isAllDay: true }), NOW),
    ).toBe(false);
    // isAllDay is ignored. Server's timed read of this same instant is true.
    expect(
      isOverdue(sample({ dueAt: DUE_EARLIER_TODAY, timezone: SHANGHAI, isAllDay: false }), NOW),
    ).toBe(false);
    expect(
      isOverdue(sample({ dueAt: DUE_YESTERDAY, timezone: SHANGHAI, isAllDay: true }), NOW),
    ).toBe(true);
  });

  it('is false for a timed task 60 minutes before now on the same local day', () => {
    // DISAGREEMENT: server (isAllDay false) is true. Date-only comparison is false.
    // Shanghai and Los Angeles are both still 2026-09-09.
    expect(
      isOverdue(
        sample({ dueAt: DUE_TIMED_60, timezone: SHANGHAI, isAllDay: false, status: 'todo' }),
        NOW,
      ),
    ).toBe(false);
  });

  it('follows task.timezone, not a viewer zone', () => {
    // DISAGREEMENT. DUE_ZONE_SPLIT is 2026-09-09 in Shanghai and 2026-09-08 in
    // Los Angeles. This side uses task.timezone: Los Angeles is true, Shanghai
    // is false. Web with viewer Shanghai is false for the Los Angeles task.
    // Server all-day matches the tz it is given. Server timed is true in both
    // zones because 04:00Z < NOW — this side does not do that.
    expect(
      isOverdue(sample({ dueAt: DUE_ZONE_SPLIT, timezone: LOS_ANGELES, isAllDay: true }), NOW),
    ).toBe(true);
    expect(
      isOverdue(sample({ dueAt: DUE_ZONE_SPLIT, timezone: SHANGHAI, isAllDay: true }), NOW),
    ).toBe(false);
    expect(
      isOverdue(sample({ dueAt: DUE_ZONE_SPLIT, timezone: LOS_ANGELES, isAllDay: false }), NOW),
    ).toBe(true);
  });
});
