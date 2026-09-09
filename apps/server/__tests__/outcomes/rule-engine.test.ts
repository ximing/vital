import { describe, expect, it } from 'vitest';
import {
  computeSignal,
  isDefer,
  isOverdue,
  needsDecomposition,
  selectRuleNextStep,
  DEFER_THRESHOLD,
  type OutcomeFacts,
} from '../../src/outcomes/rule-engine.js';

const NOW = new Date('2026-09-09T12:00:00Z');
// NOW = 2026-09-09 20:00 in Shanghai; all-day instants below use Shanghai midnight.
const TZ = 'Asia/Shanghai';

function facts(partial: Partial<OutcomeFacts>): OutcomeFacts {
  return {
    completedLast7d: 0,
    completedPrev7d: 0,
    openCount: 1,
    overdueCount: 0,
    lastActivityAt: NOW,
    ...partial,
  };
}

describe('computeSignal', () => {
  it('alerts on overdue or stale threads', () => {
    expect(computeSignal(facts({ overdueCount: 1 }), NOW)).toBe('alert');
    expect(
      computeSignal(
        facts({ lastActivityAt: new Date(NOW.getTime() - 15 * 24 * 3600 * 1000) }),
        NOW,
      ),
    ).toBe('alert');
  });

  it('ups on recent completions momentum', () => {
    expect(computeSignal(facts({ completedLast7d: 2 }), NOW)).toBe('up');
    expect(computeSignal(facts({ completedLast7d: 1, completedPrev7d: 0 }), NOW)).toBe('up');
  });

  it('flats otherwise', () => {
    expect(computeSignal(facts({}), NOW)).toBe('flat');
    expect(computeSignal(facts({ completedLast7d: 1, completedPrev7d: 1 }), NOW)).toBe('flat');
    // No tasks at all and no activity: nothing to alert about.
    expect(computeSignal(facts({ openCount: 0, lastActivityAt: null }), NOW)).toBe('flat');
  });
});

describe('isOverdue', () => {
  it('never counts an all-day task on its own local day, at any hour', () => {
    // Shanghai midnight of the 9th — the old timestamp check would flag it overdue.
    expect(isOverdue(new Date('2026-09-08T16:00:00Z'), true, NOW, TZ)).toBe(false);
    // Same at the last stored instant that still lands on the 9th.
    expect(isOverdue(new Date('2026-09-09T15:59:00Z'), true, NOW, TZ)).toBe(false);
  });

  it('counts an all-day task from the next local day', () => {
    expect(isOverdue(new Date('2026-09-07T16:00:00Z'), true, NOW, TZ)).toBe(true);
  });

  it('counts a timed task past its instant', () => {
    expect(isOverdue(new Date('2026-09-09T11:59:00Z'), false, NOW, TZ)).toBe(true);
    expect(isOverdue(new Date('2026-09-09T12:00:00Z'), false, NOW, TZ)).toBe(false);
    expect(isOverdue(new Date('2026-09-09T12:01:00Z'), false, NOW, TZ)).toBe(false);
  });

  it('uses the user timezone for the local-date cut', () => {
    // Shanghai midnight of the 9th is still the 8th in Los Angeles: overdue there, not here.
    expect(isOverdue(new Date('2026-09-08T16:00:00Z'), true, NOW, TZ)).toBe(false);
    expect(isOverdue(new Date('2026-09-08T16:00:00Z'), true, NOW, 'America/Los_Angeles')).toBe(true);
  });

  it('returns false without a due date', () => {
    expect(isOverdue(null, false, NOW, TZ)).toBe(false);
    expect(isOverdue(null, true, NOW, TZ)).toBe(false);
  });
});

describe('selectRuleNextStep', () => {
  const open = { status: 'todo', priority: 3, isAllDay: false };
  it('picks the nearest overdue task first', () => {
    const next = selectRuleNextStep(
      [
        { ...open, title: 'future', dueAt: new Date('2026-09-20T00:00:00Z') },
        { ...open, title: 'overdue', dueAt: new Date('2026-09-08T00:00:00Z') },
      ],
      NOW,
      TZ,
    );
    expect(next).toBe('overdue');
  });

  it('never picks an all-day task due today as overdue; a timed overdue task wins', () => {
    // The all-day timestamp (09-08T16:00Z) is before the timed one, so a pure
    // timestamp sort would surface it — only the overdue filter keeps it out.
    const next = selectRuleNextStep(
      [
        { ...open, title: 'allday today', dueAt: new Date('2026-09-08T16:00:00Z'), isAllDay: true },
        { ...open, title: 'timed overdue', dueAt: new Date('2026-09-09T10:00:00Z') },
      ],
      NOW,
      TZ,
    );
    expect(next).toBe('timed overdue');
  });

  it('picks an all-day task from a past local day as overdue over one due today', () => {
    const next = selectRuleNextStep(
      [
        { ...open, title: 'allday yesterday', dueAt: new Date('2026-09-07T16:00:00Z'), isAllDay: true },
        { ...open, title: 'allday today', dueAt: new Date('2026-09-08T16:00:00Z'), isAllDay: true },
      ],
      NOW,
      TZ,
    );
    expect(next).toBe('allday yesterday');
  });

  it('then the nearest upcoming due, then highest priority; null when nothing open', () => {
    expect(
      selectRuleNextStep(
        [
          { ...open, title: 'later', dueAt: new Date('2026-09-20T00:00:00Z') },
          { ...open, title: 'sooner', dueAt: new Date('2026-09-10T00:00:00Z') },
        ],
        NOW,
        TZ,
      ),
    ).toBe('sooner');
    expect(
      selectRuleNextStep(
        [
          { ...open, title: 'low', priority: 3, dueAt: null },
          { ...open, title: 'high', priority: 0, dueAt: null },
        ],
        NOW,
        TZ,
      ),
    ).toBe('high');
    expect(
      selectRuleNextStep([{ ...open, title: 'x', status: 'done', dueAt: null }], NOW, TZ),
    ).toBeNull();
    expect(selectRuleNextStep([], NOW, TZ)).toBeNull();
  });
});

describe('isDefer', () => {
  const prev = new Date('2026-09-09T00:00:00Z');
  it('counts only strict forward pushes', () => {
    expect(isDefer(prev, new Date('2026-09-10T00:00:00Z'), NOW)).toBe(true);
    expect(isDefer(prev, new Date('2026-09-08T00:00:00Z'), NOW)).toBe(false);
    expect(isDefer(prev, prev, NOW)).toBe(false);
  });
  it('null→date, clearing, and untouched are not defers', () => {
    expect(isDefer(null, new Date('2026-09-10T00:00:00Z'), NOW)).toBe(false);
    expect(isDefer(prev, null, NOW)).toBe(false);
    expect(isDefer(prev, undefined, NOW)).toBe(false);
  });
});

describe('needsDecomposition', () => {
  it('triggers at the threshold', () => {
    expect(needsDecomposition(DEFER_THRESHOLD - 1)).toBe(false);
    expect(needsDecomposition(DEFER_THRESHOLD)).toBe(true);
  });
});
