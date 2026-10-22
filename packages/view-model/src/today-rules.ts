import type { Habit, Outcome, OutcomeSignal, Task } from '@vital/dto';

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

/**
 * Today's progress for rings and chips.
 * Count habits spawn one instance at a time (relay), so `todayTotal` trails
 * completions — the denominator is the daily target, not spawned count.
 * Daily habits are binary: any completion fills the ring.
 */
export function habitProgress(habit: Habit): { done: number; total: number; complete: boolean } {
  if (habit.kind === 'count' && habit.targetCount !== null && habit.targetCount > 0) {
    const total = habit.targetCount;
    const done = Math.min(habit.todayDone, total);
    return { done, total, complete: done >= total };
  }
  const total = Math.max(habit.todayTotal, 1);
  const done = Math.min(habit.todayDone, total);
  return { done, total, complete: habit.todayDone > 0 };
}

export const habitTodayProgress = habitProgress;

/** Open instance to tick. Prefer the newest todo/doing; ignore completed relays. */
export function habitTodayTask(tasks: Task[], habitId: string): Task | null {
  let found: Task | null = null;
  for (const task of tasks) {
    if (task.habitId !== habitId || task.deletedAt !== null) continue;
    if (task.status !== 'todo' && task.status !== 'doing') continue;
    if (found === null || task.createdAt > found.createdAt) found = task;
  }
  return found;
}

/** Progress chip text for a habit row, e.g. 「喝水 3/8」. */
export function habitChipText(habit: Habit): string {
  const { done, total } = habitProgress(habit);
  return `${habit.name} ${String(done)}/${String(total)}`;
}

export function habitById(habits: Habit[], id: string | null): Habit | undefined {
  if (id === null) return undefined;
  return habits.find((habit) => habit.id === id);
}

export function chineseYmd(ymd: string): string {
  const [year, month, day] = ymd.split('-');
  return `${year ?? ''}年${String(Number(month))}月${String(Number(day))}日`;
}
