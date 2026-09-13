import type { Habit, Task } from '@vital/dto';
import { t } from '@/copy';
import { HabitRing } from './HabitRing';
import { habitTodayProgress } from './model';

/**
 * Compact habit card on /today: progress ring as the check-in control,
 * name + today's count beside it. Completed habits stay visible.
 */
export function HabitCard({
  habit,
  task,
  onComplete,
}: {
  habit: Habit;
  task: Task | null;
  onComplete: (task: Task) => void;
}) {
  const { done, total, complete } = habitTodayProgress(habit);
  const canTick = !complete && task !== null;
  const sub =
    complete && habit.kind !== 'count'
      ? t.settings.habits.todayDone
      : t.settings.habits.todayProgress
          .replace('{done}', String(done))
          .replace('{total}', String(total));

  return (
    <div
      data-region="habit-row"
      data-habit-id={habit.id}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-elevated px-3 py-2.5"
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={complete}
        aria-label={habit.name}
        disabled={!canTick}
        className="shrink-0 cursor-pointer rounded-full disabled:cursor-default"
        onClick={(event) => {
          event.stopPropagation();
          if (task && canTick) onComplete(task);
        }}
      >
        <HabitRing done={done} total={total} complete={complete} />
      </button>
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span
          className={`block max-w-full truncate text-[length:var(--text-body)] font-semibold leading-[var(--text-body-lh)] ${
            complete ? 'text-muted' : 'text-fg'
          }`}
        >
          {habit.name}
        </span>
        <span
          className={`mt-1 inline-flex h-5 max-w-full items-center rounded-full px-2 font-mono text-[11px] tabular-nums ${
            done > 0 ? 'bg-accent-subtle font-semibold text-accent' : 'bg-surface-muted text-muted'
          }`}
        >
          <span className="truncate">{sub}</span>
        </span>
      </span>
    </div>
  );
}
