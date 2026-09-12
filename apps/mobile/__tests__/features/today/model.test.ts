import type { AgentActionLogItem, Habit, Outcome, Task } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import {
  cardDisplay,
  habitChipText,
  isUndoable,
  pendingProposals,
  postponeDueAt,
} from '../../../src/features/today/model';
import { zonedLocalMidnightIso } from '../../../src/lib/format';

const NOW = new Date('2026-09-09T12:00:00.000Z');

function makeOutcome(over: Partial<Outcome> & Pick<Outcome, 'id' | 'name'>): Outcome {
  return {
    status: 'open',
    createdBy: 'user',
    ruleSignal: 'flat',
    ruleNextStep: null,
    agentHeadline: null,
    agentSuggestion: null,
    agentState: 'idle',
    agentUpdatedAt: null,
    undoUntil: null,
    lastActivityAt: null,
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    openTaskCount: 0,
    completedLast7d: 0,
    materialCount: 0,
    ...over,
  };
}

function makeTask(over: Partial<Task> = {}): Task {
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
    timezone: 'Asia/Shanghai',
    dueAt: null,
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

function makeAction(over: Partial<AgentActionLogItem> & Pick<AgentActionLogItem, 'id'>): AgentActionLogItem {
  return {
    actionType: 'outcome.headline',
    targetType: 'outcome',
    targetId: 'o1',
    payload: {},
    feedback: 'pending',
    feedbackPayload: null,
    feedbackAt: null,
    createdAt: '2026-09-09T00:00:00.000Z',
    targetName: '线程',
    payloadSummary: '摘要',
    ...over,
  };
}

describe('isUndoable', () => {
  it('only agent-created outcomes inside the window can be undone', () => {
    expect(
      isUndoable(
        makeOutcome({ id: 'o1', name: 'x', createdBy: 'agent', undoUntil: '2026-09-10T00:00:00.000Z' }),
        NOW,
      ),
    ).toBe(true);

    expect(
      isUndoable(
        makeOutcome({ id: 'o2', name: 'x', createdBy: 'agent', undoUntil: '2026-09-09T00:00:00.000Z' }),
        NOW,
      ),
    ).toBe(false);

    expect(
      isUndoable(
        makeOutcome({ id: 'o3', name: 'x', createdBy: 'user', undoUntil: '2026-09-10T00:00:00.000Z' }),
        NOW,
      ),
    ).toBe(false);

    expect(isUndoable(makeOutcome({ id: 'o4', name: 'x', createdBy: 'agent', undoUntil: null }), NOW)).toBe(
      false,
    );
  });

  it('treats undoUntil equal to now as expired', () => {
    expect(
      isUndoable(
        makeOutcome({ id: 'o5', name: 'x', createdBy: 'agent', undoUntil: NOW.toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe('cardDisplay', () => {
  it('prefers the agent headline and falls back to the rule next-step', () => {
    const agent = cardDisplay(
      makeOutcome({ id: 'o1', name: 'x', agentHeadline: '本周推进了三件事', ruleNextStep: '写纪要' }),
      NOW,
    );
    expect(agent.headline).toBe('本周推进了三件事');
    expect(agent.nextStep).toBe('写纪要');
    expect(agent.signal).toBe('flat');

    const ruleOnly = cardDisplay(makeOutcome({ id: 'o2', name: 'x', ruleNextStep: '写纪要' }), NOW);
    expect(ruleOnly.headline).toBe('写纪要');
    expect(ruleOnly.nextStep).toBeNull();

    expect(cardDisplay(makeOutcome({ id: 'o3', name: 'x' }), NOW).headline).toBeNull();
  });

  it('derives pending / failed / undoable flags from the outcome', () => {
    const pending = cardDisplay(makeOutcome({ id: 'o1', name: 'x', agentState: 'pending' }), NOW);
    expect(pending.pending).toBe(true);
    expect(pending.failed).toBe(false);

    const failed = cardDisplay(makeOutcome({ id: 'o2', name: 'x', agentState: 'failed' }), NOW);
    expect(failed.failed).toBe(true);
    expect(failed.pending).toBe(false);

    const undoable = cardDisplay(
      makeOutcome({
        id: 'o3',
        name: 'x',
        createdBy: 'agent',
        undoUntil: '2026-09-10T00:00:00.000Z',
      }),
      NOW,
    );
    expect(undoable.undoable).toBe(true);
  });
});

describe('habitChipText', () => {
  it('uses targetCount as denominator for count habits (relay spawns trail completions)', () => {
    const habit: Habit = {
      id: 'h1',
      name: '喝水',
      kind: 'count',
      targetCount: 8,
      windowStart: '08:00',
      windowEnd: '22:00',
      active: true,
      createdBy: 'user',
      sortOrder: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      todayDone: 3,
      todayTotal: 4,
    };
    expect(habitChipText(habit)).toBe('喝水 3/8');
  });

  it('keeps spawned total for daily habits', () => {
    const habit: Habit = {
      id: 'h2',
      name: '锻炼',
      kind: 'daily',
      targetCount: null,
      windowStart: null,
      windowEnd: null,
      active: true,
      createdBy: 'user',
      sortOrder: 1,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      todayDone: 0,
      todayTotal: 1,
    };
    expect(habitChipText(habit)).toBe('锻炼 0/1');
  });
});

describe('postponeDueAt', () => {
  const tz = 'Asia/Shanghai';
  const now = new Date('2026-09-06T10:00:00.000Z');

  it('snaps all-day tasks to local midnight today', () => {
    const dueAt = postponeDueAt(
      makeTask({ dueAt: '2026-09-04T16:00:00.000Z', isAllDay: true, timezone: tz }),
      tz,
      now,
    );
    expect(dueAt).toBe(zonedLocalMidnightIso(tz, '2026-09-06'));
    expect(dueAt).toBe('2026-09-05T16:00:00.000Z');
  });

  it('keeps the clock time when shifting a timed task onto today', () => {
    // 2026-09-04 15:00 Shanghai
    const dueAt = postponeDueAt(
      makeTask({ dueAt: '2026-09-04T07:00:00.000Z', isAllDay: false, timezone: tz }),
      tz,
      now,
    );
    expect(dueAt).toBe('2026-09-06T07:00:00.000Z');
  });

  it('returns null when the task has no dueAt', () => {
    expect(postponeDueAt(makeTask({ dueAt: null }), tz, now)).toBeNull();
  });
});

describe('pendingProposals', () => {
  it('keeps pending rows and caps at three', () => {
    const rows = [
      makeAction({ id: 'a1', feedback: 'accepted' }),
      makeAction({ id: 'p1' }),
      makeAction({ id: 'p2' }),
      makeAction({ id: 'p3' }),
      makeAction({ id: 'p4' }),
      makeAction({ id: 'a2', feedback: 'dismissed' }),
    ];
    expect(pendingProposals(rows).map((row) => row.id)).toEqual(['p1', 'p2', 'p3']);
  });
});
