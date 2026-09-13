import type { Habit, Task } from '@vital/dto';
import { Check } from 'lucide-react';
import { t } from '@/copy';
import { habitChipText, habitTodayProgress } from './model';

/**
 * One row per active habit on /today: always visible, including after today's
 * instances are done, so completed work stays as feedback. The checkbox ticks
 * the current open instance when there is one.
 */
export function HabitRow({
  habit,
  task,
  onComplete,
}: {
  habit: Habit;
  task: Task | null;
  onComplete: (task: Task) => void;
}) {
  const { complete } = habitTodayProgress(habit);
  const canTick = !complete && task !== null;
  return (
    <div
      data-region="habit-row"
      data-habit-id={habit.id}
      className="flex items-center gap-2.5 px-2 py-2"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={complete}
        aria-label={habit.name}
        disabled={!canTick}
        className={`mt-0.5 flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-full border-[1.5px] ${
          complete ? 'border-done bg-done' : 'border-tertiary'
        } disabled:opacity-60`}
        onClick={(event) => {
          event.stopPropagation();
          if (task && canTick) onComplete(task);
        }}
      >
        {complete ? <Check size={11} strokeWidth={3.2} className="text-on-accent" aria-hidden /> : null}
      </button>
      <span
        className={`min-w-0 truncate text-[length:var(--text-body)] ${
          complete ? 'text-muted' : 'text-fg'
        }`}
      >
        {habit.name}
      </span>
      <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-tertiary">
        {complete && habit.kind !== 'count' ? t.settings.habits.todayDone : habitChipText(habit)}
      </span>
    </div>
  );
}
