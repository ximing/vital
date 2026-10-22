import type { AgentActionLogItem, CreateHabitInput, Task } from '@vital/dto';
import { copy } from '../../lib/copy';
import { formatHm, fromDatetimeLocal, localDateStamp, zonedLocalMidnightIso } from '../../lib/format';

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
