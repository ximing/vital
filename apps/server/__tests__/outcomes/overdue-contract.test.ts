// The three isOverdue contracts differ. This file locks the server side.
// Do not change these expectations to match web or mobile in a move-only refactor.
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
// This function has no status argument. Done and canceled are not locked here.

import { describe, expect, it } from 'vitest';
import { isOverdue } from '../../src/outcomes/rule-engine.js';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const SHANGHAI = 'Asia/Shanghai';
const LOS_ANGELES = 'America/Los_Angeles';
const DUE_EARLIER_TODAY = new Date('2026-09-08T16:00:00.000Z');
const DUE_YESTERDAY = new Date('2026-09-07T16:00:00.000Z');
const DUE_TIMED_60 = new Date('2026-09-09T11:00:00.000Z');
const DUE_ZONE_SPLIT = new Date('2026-09-09T04:00:00.000Z');

describe('isOverdue contract (server)', () => {
  it('is false when dueAt is null', () => {
    expect(isOverdue(null, false, NOW, SHANGHAI)).toBe(false);
    expect(isOverdue(null, true, NOW, SHANGHAI)).toBe(false);
  });

  it('counts all-day tasks by local date, not by the stored instant', () => {
    // Shanghai. Midnight of today has passed, but the local date has not.
    expect(isOverdue(DUE_EARLIER_TODAY, true, NOW, SHANGHAI)).toBe(false);
    expect(isOverdue(DUE_YESTERDAY, true, NOW, SHANGHAI)).toBe(true);
    // Same earlier-today instant, timed: overdue. Web and mobile stay false.
    expect(isOverdue(DUE_EARLIER_TODAY, false, NOW, SHANGHAI)).toBe(true);
  });

  it('counts a timed task 60 minutes before now on the same local day', () => {
    // DISAGREEMENT: web and mobile compare local dates only, so they are false.
    // Timed overdue ignores tz; Los Angeles is the same local date and still true.
    expect(isOverdue(DUE_TIMED_60, false, NOW, SHANGHAI)).toBe(true);
    expect(isOverdue(DUE_TIMED_60, false, NOW, LOS_ANGELES)).toBe(true);
  });

  it('follows tz for all-day dates and ignores tz once the task is timed', () => {
    // DISAGREEMENT. All-day follows tz: Shanghai 2026-09-09 is not overdue,
    // Los Angeles 2026-09-08 is. Web's viewer zone and mobile's task.timezone
    // split the same way.
    expect(isOverdue(DUE_ZONE_SPLIT, true, NOW, SHANGHAI)).toBe(false);
    expect(isOverdue(DUE_ZONE_SPLIT, true, NOW, LOS_ANGELES)).toBe(true);
    // "Follows tz" is not true for timed tasks. 04:00Z is before NOW, so both
    // zones are true. Web (viewer Shanghai) stays false and mobile (task
    // timezone Los Angeles) stays true when isAllDay is false. Do not unify.
    expect(isOverdue(DUE_ZONE_SPLIT, false, NOW, SHANGHAI)).toBe(true);
    expect(isOverdue(DUE_ZONE_SPLIT, false, NOW, LOS_ANGELES)).toBe(true);
  });
});
