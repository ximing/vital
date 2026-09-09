import type { AgentAction, Habit, Outcome } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import { t } from '@/copy';
import {
  cardDisplay,
  decomposeDeferCount,
  decomposeSubtasks,
  habitChipText,
  habitTemplateInputs,
  isUndoable,
  pendingDecomposeAction,
  sortOutcomes,
} from '../../../src/features/today/model';

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

describe('isUndoable', () => {
  it('only agent-created outcomes inside the window can be undone', () => {
    const agentFresh = makeOutcome({
      id: 'o1',
      name: 'x',
      createdBy: 'agent',
      undoUntil: '2026-09-10T00:00:00.000Z',
    });
    expect(isUndoable(agentFresh, NOW)).toBe(true);

    const agentExpired = makeOutcome({
      id: 'o2',
      name: 'x',
      createdBy: 'agent',
      undoUntil: '2026-09-09T00:00:00.000Z',
    });
    expect(isUndoable(agentExpired, NOW)).toBe(false);

    const userFresh = makeOutcome({
      id: 'o3',
      name: 'x',
      createdBy: 'user',
      undoUntil: '2026-09-10T00:00:00.000Z',
    });
    expect(isUndoable(userFresh, NOW)).toBe(false);

    const noWindow = makeOutcome({ id: 'o4', name: 'x', createdBy: 'agent', undoUntil: null });
    expect(isUndoable(noWindow, NOW)).toBe(false);
  });
});

describe('cardDisplay', () => {
  it('prefers the agent headline and falls back to the rule next-step', () => {
    const agent = makeOutcome({
      id: 'o1',
      name: 'x',
      agentHeadline: '本周推进了三件事',
      ruleNextStep: '写纪要',
    });
    const view = cardDisplay(agent, NOW);
    expect(view.headline).toBe('本周推进了三件事');
    expect(view.nextStep).toBe('写纪要');

    const ruleOnly = makeOutcome({ id: 'o2', name: 'x', ruleNextStep: '写纪要' });
    const ruleView = cardDisplay(ruleOnly, NOW);
    expect(ruleView.headline).toBe('写纪要');
    // Fallback consumed the slot — no duplicate next-step block.
    expect(ruleView.nextStep).toBeNull();

    const empty = makeOutcome({ id: 'o3', name: 'x' });
    expect(cardDisplay(empty, NOW).headline).toBeNull();
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

describe('sortOutcomes', () => {
  it('orders by sortOrder, then creation time', () => {
    const a = makeOutcome({ id: 'a', name: 'a', sortOrder: 2 });
    const b = makeOutcome({
      id: 'b',
      name: 'b',
      sortOrder: 1,
      createdAt: '2026-09-02T00:00:00.000Z',
    });
    const c = makeOutcome({ id: 'c', name: 'c', sortOrder: 1 });
    expect(sortOutcomes([a, b, c]).map((o) => o.id)).toEqual(['c', 'b', 'a']);
    expect(a.sortOrder).toBe(2);
  });
});

describe('habitChipText', () => {
  it('formats name plus progress', () => {
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
      todayTotal: 8,
    };
    expect(habitChipText(habit)).toBe('喝水 3/8');
  });

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

describe('habitTemplateInputs', () => {
  it('mirrors the server templates: water count×8 windowed, exercise and reading daily', () => {
    const templates = habitTemplateInputs();
    expect(templates).toHaveLength(3);
    expect(templates[0]).toEqual({
      name: t.today.habitTemplateWater,
      kind: 'count',
      targetCount: 8,
      windowStart: '08:00',
      windowEnd: '22:00',
    });
    expect(templates[1]).toEqual({ name: t.today.habitTemplateExercise, kind: 'daily' });
    expect(templates[2]).toEqual({ name: t.today.habitTemplateReading, kind: 'daily' });
  });
});

describe('decompose proposal parsing', () => {
  function makeAction(payload: Record<string, unknown>): AgentAction {
    return {
      id: 'a1',
      actionType: 'task.decompose',
      targetType: 'task',
      targetId: 'task-1',
      payload,
      feedback: 'pending',
      feedbackPayload: null,
      feedbackAt: null,
      createdAt: '2026-09-09T00:00:00.000Z',
    };
  }

  it('picks the newest pending task.decompose action', () => {
    const other = { ...makeAction({ subtasks: [] }), actionType: 'outcome.headline' as const };
    expect(pendingDecomposeAction([other])).toBeNull();
    const decompose = makeAction({ subtasks: [{ title: 'x' }] });
    expect(pendingDecomposeAction([other, decompose])).toBe(decompose);
  });

  it('parses subtasks defensively, dropping malformed entries', () => {
    const action = makeAction({
      subtasks: [
        { title: '列大纲', estimateMinutes: 15 },
        { title: '  ' },
        { title: '无估时' },
        'junk',
        { estimateMinutes: 30 },
      ],
      deferCount: 4,
    });
    expect(decomposeSubtasks(action)).toEqual([
      { title: '列大纲', estimateMinutes: 15 },
      { title: '无估时', estimateMinutes: null },
    ]);
    expect(decomposeDeferCount(action)).toBe(4);
  });

  it('returns empty for a missing or malformed payload', () => {
    expect(decomposeSubtasks(makeAction({}))).toEqual([]);
    expect(decomposeSubtasks(makeAction({ subtasks: 'nope' }))).toEqual([]);
    expect(decomposeDeferCount(makeAction({}))).toBeNull();
  });
});
