import { describe, expect, it } from 'vitest';
import type { Habit, Outcome } from '@vital/dto';
import {
  cardDisplay,
  chineseYmd,
  habitProgress,
  habitTodayProgress,
  isUndoable,
  sortOutcomes,
} from '../src/index.js';

function outcome(over: Pick<Outcome, 'id'> & Partial<Outcome>): Outcome {
  return {
    name: '',
    status: 'open',
    createdBy: 'user',
    ruleSignal: null,
    ruleNextStep: null,
    agentHeadline: null,
    agentState: 'idle',
    undoUntil: null,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Outcome;
}

function habit(over: Pick<Habit, 'id'> & Partial<Habit>): Habit {
  return {
    name: '',
    kind: 'daily',
    targetCount: null,
    todayDone: 0,
    todayTotal: 0,
    ...over,
  } as Habit;
}

const NOW = new Date('2026-10-23T12:00:00.000Z');

describe('today rules', () => {
  it('lets an agent thread be undone while undoUntil is in the future', () => {
    expect(
      isUndoable(
        outcome({ id: 'o1', createdBy: 'agent', undoUntil: '2026-10-24T00:00:00.000Z' }),
        NOW,
      ),
    ).toBe(true);
  });

  it('prefers the agent headline and shows nextStep only when both exist', () => {
    const both = cardDisplay(
      outcome({ id: 'o1', agentHeadline: '对齐线程', ruleNextStep: '写下一节' }),
      NOW,
    );
    expect(both.headline).toBe('对齐线程');
    expect(both.nextStep).toBe('写下一节');

    const ruleOnly = cardDisplay(outcome({ id: 'o2', ruleNextStep: '写下一节' }), NOW);
    expect(ruleOnly.headline).toBe('写下一节');
    expect(ruleOnly.nextStep).toBeNull();
  });

  it('keeps a count habit incomplete at 6/8 and completes a daily habit after one tick', () => {
    expect(habitProgress).toBe(habitTodayProgress);
    expect(
      habitProgress(habit({ id: 'h1', kind: 'count', targetCount: 8, todayDone: 6, todayTotal: 6 })),
    ).toEqual({ done: 6, total: 8, complete: false });
    expect(
      habitTodayProgress(habit({ id: 'h2', kind: 'daily', todayDone: 1, todayTotal: 2 })),
    ).toEqual({ done: 1, total: 2, complete: true });
  });

  it('sorts outcomes by sortOrder then createdAt', () => {
    const items = [
      outcome({ id: 'b', sortOrder: 1, createdAt: '2026-02-01T00:00:00.000Z' }),
      outcome({ id: 'a', sortOrder: 0, createdAt: '2026-03-01T00:00:00.000Z' }),
      outcome({ id: 'c', sortOrder: 1, createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    expect(sortOutcomes(items).map((item) => item.id)).toEqual(['a', 'c', 'b']);
  });

  it("formats chineseYmd('2026-10-23') as 2026年10月23日", () => {
    expect(chineseYmd('2026-10-23')).toBe('2026年10月23日');
  });
});
