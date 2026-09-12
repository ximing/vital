import type {
  AgentActionLogItem,
  CreateHabitInput,
  Habit,
  Outcome,
  OutcomeSignal,
  Task,
} from '@vital/dto';
import { copy } from '../../lib/copy';
import { formatHm, fromDatetimeLocal, localDateStamp, zonedLocalMidnightIso } from '../../lib/format';

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
      outcome.agentHeadline !== null && outcome.ruleNextStep !== null ? outcome.ruleNextStep : null,
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
      name: copy.today.habitTemplateWater,
      kind: 'count',
      targetCount: 8,
      windowStart: '08:00',
      windowEnd: '22:00',
    },
    { name: copy.today.habitTemplateExercise, kind: 'daily' },
    { name: copy.today.habitTemplateReading, kind: 'daily' },
  ];
}

/** Push an overdue dueAt onto today, keeping all-day vs time-of-day. */
export function postponeDueAt(task: Task, tz: string, now = new Date()): string | null {
  if (task.dueAt === null) return null;
  const today = localDateStamp(tz, now);
  if (task.isAllDay) return zonedLocalMidnightIso(tz, today);
  return fromDatetimeLocal(`${today}T${formatHm(task.dueAt, tz)}`, tz);
}

/** Newest pending proposals, capped at three for the today card. */
export function pendingProposals(actions: AgentActionLogItem[]): AgentActionLogItem[] {
  return actions.filter((item) => item.feedback === 'pending').slice(0, 3);
}
