import type { Habit } from '@vital/dto';
import { useRef, useState } from 'react';
import { t } from '@/copy';
import { HabitRing } from './HabitRing';
import { habitTodayProgress } from './model';

/**
 * Compact habit card on /today: the whole card checks in, the ring previews
 * that on hover. Completed habits stay visible and are not clickable.
 */
export function HabitCard({
  habit,
  onTick,
}: {
  habit: Habit;
  onTick: () => void | Promise<void>;
}) {
  const { done, total, complete } = habitTodayProgress(habit);
  const tickable = !complete;
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const sub =
    complete && habit.kind !== 'count'
      ? t.settings.habits.todayDone
      : t.settings.habits.todayProgress
          .replace('{done}', String(done))
          .replace('{total}', String(total));

  async function tick(): Promise<void> {
    if (!tickable || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await onTick();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={complete}
      aria-label={habit.name}
      disabled={!tickable || pending}
      data-region="habit-row"
      data-habit-id={habit.id}
      onClick={() => void tick()}
      className="group/habit flex min-w-0 w-full items-center gap-3 rounded-xl border border-border bg-elevated px-3 py-2.5 text-left transition-[background-color,border-color] duration-[var(--ease-out)] cursor-pointer enabled:hover:border-accent enabled:hover:bg-surface disabled:cursor-default"
    >
      <HabitRing done={done} total={total} complete={complete} interactive={tickable && !pending} />
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
    </button>
  );
}
