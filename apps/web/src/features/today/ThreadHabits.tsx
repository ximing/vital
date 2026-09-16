import type { Habit } from '@vital/dto';
import { t } from '@/copy';
import { habitTodayProgress } from './model';

export function ThreadHabits({ habits }: { habits: Habit[] }) {
  return (
    <section aria-label={t.thread.habitsSection} className="mt-8">
      <h2 className="eyebrow eyebrow-rule px-2">{t.thread.habitsSection}</h2>
      {habits.length === 0 ? (
        <p className="px-2 py-4 text-center text-[length:var(--text-meta)] text-muted">
          {t.thread.emptyHabits}
        </p>
      ) : (
        <ul className="mt-2">
          {habits.map((habit) => {
            const progress = habitTodayProgress(habit);
            return (
              <li
                key={habit.id}
                className="flex items-center gap-3 border-b border-border/60 px-2 py-2.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-[length:var(--text-body)] text-fg">
                  {habit.name}
                </span>
                <span className="shrink-0 font-mono text-[length:var(--text-caption)] tabular-nums text-tertiary">
                  {progress.done}/{progress.total}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
