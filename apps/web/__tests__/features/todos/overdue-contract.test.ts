// The three isOverdue contracts differ. This file locks the web side.
// Do not change these expectations to match server or mobile in a move-only refactor.
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
// Comparisons use the timeZone argument, not task.timezone. isAllDay is ignored.
// Only todo and doing are eligible.

import type { Task } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import { isOverdue } from '../../../src/features/todos/model';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const SHANGHAI = 'Asia/Shanghai';
const LOS_ANGELES = 'America/Los_Angeles';
const DUE_EARLIER_TODAY = '2026-09-08T16:00:00.000Z';
const DUE_YESTERDAY = '2026-09-07T16:00:00.000Z';
const DUE_TIMED_60 = '2026-09-09T11:00:00.000Z';
const DUE_ZONE_SPLIT = '2026-09-09T04:00:00.000Z';

function makeTask(over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    listId: 'inbox-1',
    parentId: null,
    outcomeId: null,
    estimateMinutes: null,
    deferCount: 0,
    delegable: false,
    habitId: null,
    habitSeq: null,
    notes: '',
    status: 'todo',
    priority: 3,
    pinned: false,
    dueAt: null,
    startAt: null,
    reminderMode: null,
    reminderOffsetMinutes: null,
    reminderAt: null,
    isAllDay: true,
    timezone: SHANGHAI,
    recurrence: null,
    recurrenceKind: null,
    recurrenceDtstart: null,
    completedAt: null,
    sortOrder: 1024,
    tagIds: [],
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('isOverdue contract (web)', () => {
  it('is false when dueAt is null', () => {
    expect(isOverdue(makeTask({ id: 'none', title: 'none' }), SHANGHAI, NOW)).toBe(false);
  });

  it('is false for done and canceled even when the local due date is past', () => {
    // DUE_YESTERDAY is before today in Shanghai. An open todo is true below.
    const past: Partial<Task> = { dueAt: DUE_YESTERDAY, isAllDay: true, timezone: SHANGHAI };
    expect(
      isOverdue(makeTask({ id: 'done', title: 'done', status: 'done', ...past }), SHANGHAI, NOW),
    ).toBe(false);
    expect(
      isOverdue(
        makeTask({ id: 'canceled', title: 'canceled', status: 'canceled', ...past }),
        SHANGHAI,
        NOW,
      ),
    ).toBe(false);
  });

  it('compares local dates for an all-day due earlier today and yesterday', () => {
    expect(
      isOverdue(
        makeTask({ id: 'today', title: 'today', dueAt: DUE_EARLIER_TODAY, isAllDay: true }),
        SHANGHAI,
        NOW,
      ),
    ).toBe(false);
    // isAllDay is ignored. Server's timed read of this same instant is true.
    expect(
      isOverdue(
        makeTask({
          id: 'today-timed',
          title: 'today-timed',
          dueAt: DUE_EARLIER_TODAY,
          isAllDay: false,
        }),
        SHANGHAI,
        NOW,
      ),
    ).toBe(false);
    expect(
      isOverdue(
        makeTask({ id: 'yesterday', title: 'yesterday', dueAt: DUE_YESTERDAY, isAllDay: true }),
        SHANGHAI,
        NOW,
      ),
    ).toBe(true);
  });

  it('is false for a timed task 60 minutes before now on the same local day', () => {
    // DISAGREEMENT: server (isAllDay false) is true. Date-only comparison is false.
    // Shanghai and Los Angeles are both still 2026-09-09.
    expect(
      isOverdue(
        makeTask({
          id: 'timed',
          title: 'timed',
          dueAt: DUE_TIMED_60,
          isAllDay: false,
          timezone: SHANGHAI,
        }),
        SHANGHAI,
        NOW,
      ),
    ).toBe(false);
  });

  it('follows the viewer zone, not task.timezone', () => {
    // DISAGREEMENT. task.timezone is Los Angeles. DUE_ZONE_SPLIT is 2026-09-09
    // in Shanghai and 2026-09-08 in Los Angeles, so the zones disagree.
    // Actual viewer results: Shanghai false, Los Angeles true.
    // Mobile uses task.timezone, so this task is true there. Server all-day
    // matches the tz it is given. Server timed is true in both zones because
    // 04:00Z < NOW — this side does not do that (Shanghai stays false).
    const split = makeTask({
      id: 'split',
      title: 'split',
      dueAt: DUE_ZONE_SPLIT,
      isAllDay: true,
      timezone: LOS_ANGELES,
    });
    expect(isOverdue(split, SHANGHAI, NOW)).toBe(false);
    expect(isOverdue(split, LOS_ANGELES, NOW)).toBe(true);
    expect(isOverdue({ ...split, isAllDay: false }, SHANGHAI, NOW)).toBe(false);
  });
});
