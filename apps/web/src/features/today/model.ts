import type { AgentAction, CreateHabitInput } from '@vital/dto';
import { t } from '@/copy';

export {
  cardDisplay,
  habitById,
  habitChipText,
  habitProgress,
  habitTodayProgress,
  habitTodayTask,
  isUndoable,
  sortOutcomes,
} from '@vital/view-model';
export type { OutcomeCardDisplay } from '@vital/view-model';

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
