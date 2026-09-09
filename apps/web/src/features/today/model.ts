import type { AgentAction, CreateHabitInput, Habit, Outcome, OutcomeSignal } from '@vital/dto';
import { t } from '@/copy';

/** Agent-created threads can be hard-deleted while `undoUntil` is in the future. */
export function isUndoable(outcome: Outcome, now: Date): boolean {
  return (
    outcome.createdBy === 'agent' &&
    outcome.undoUntil !== null &&
    new Date(outcome.undoUntil).getTime() > now.getTime()
  );
}

export type OutcomeCardDisplay = {
  signal: OutcomeSignal | null;
  /** Agent headline wins; rule next-step is the always-fresh fallback. */
  headline: string | null;
  /** Rule next-step shown as its own block only when the agent headline took the headline slot. */
  nextStep: string | null;
  pending: boolean;
  failed: boolean;
  undoable: boolean;
};

export function cardDisplay(outcome: Outcome, now: Date): OutcomeCardDisplay {
  const headline = outcome.agentHeadline ?? outcome.ruleNextStep;
  return {
    signal: outcome.ruleSignal,
    headline,
    nextStep:
      outcome.agentHeadline !== null && outcome.ruleNextStep !== null
        ? outcome.ruleNextStep
        : null,
    pending: outcome.agentState === 'pending',
    failed: outcome.agentState === 'failed',
    undoable: isUndoable(outcome, now),
  };
}

export function sortOutcomes(outcomes: Outcome[]): Outcome[] {
  return [...outcomes].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
  );
}

/** Progress chip text for a habit row, e.g. 「喝水 3/8」. */
export function habitChipText(habit: Habit): string {
  // Count habits spawn instances one at a time (relay), so todayTotal trails
  // completions — the meaningful denominator is the daily target.
  const total = habit.kind === 'count' && habit.targetCount !== null ? habit.targetCount : habit.todayTotal;
  return `${habit.name} ${habit.todayDone}/${total}`;
}

export function habitById(habits: Habit[], id: string | null): Habit | undefined {
  if (id === null) return undefined;
  return habits.find((habit) => habit.id === id);
}

/**
 * One-click starter habits for the empty state. Mirrors the server's
 * HABIT_TEMPLATES (names come from copy so they stay localizable).
 */
export function habitTemplateInputs(): CreateHabitInput[] {
  return [
    {
      name: t.today.habitTemplateWater,
      kind: 'count',
      targetCount: 8,
      windowStart: '08:00',
      windowEnd: '22:00',
    },
    { name: t.today.habitTemplateExercise, kind: 'daily' },
    { name: t.today.habitTemplateReading, kind: 'daily' },
  ];
}

export interface DecomposeSubtask {
  title: string;
  estimateMinutes: number | null;
}

/** Newest pending task.decompose proposal, if any. */
export function pendingDecomposeAction(actions: AgentAction[]): AgentAction | null {
  return actions.find((action) => action.actionType === 'task.decompose') ?? null;
}

/** Defensive parse of the proposal payload — the ledger stores free-form jsonb. */
export function decomposeSubtasks(action: AgentAction): DecomposeSubtask[] {
  const raw = action.payload['subtasks'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): DecomposeSubtask[] => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record['title'] !== 'string' || record['title'].trim() === '') return [];
    const estimate = record['estimateMinutes'];
    return [
      {
        title: record['title'],
        estimateMinutes: typeof estimate === 'number' && estimate > 0 ? estimate : null,
      },
    ];
  });
}

/** Defer count carried on the proposal payload (drives the banner title). */
export function decomposeDeferCount(action: AgentAction): number | null {
  const value = action.payload['deferCount'];
  return typeof value === 'number' && value > 0 ? value : null;
}
