import type { Habit } from '@vital/dto';
import { useService } from '@rabjs/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { todayKeys, useHabitsQuery, useOutcomesQuery } from '@/features/today';
import { formatYmd, todayYmd } from '@/features/todos/model';
import { addDaysYmd } from '@/lib/calendar-grid';
import { AuthService } from '@/services/auth.service';
import { HabitMonthNav } from './HabitMonthNav';
import { EmptyState } from './habits/EmptyState';
import { HabitCard } from './habits/HabitCard';
import { HabitDialog } from './habits/HabitDialog';
import { OverviewBar } from './habits/OverviewBar';
import { checkinsFor, monthRange } from './habits/stats';

const copy = t.settings.habits;

type Filter = 'all' | 'active' | 'paused';

export function HabitsSection({
  adding,
  onStartAdding,
  onDoneAdding,
}: {
  adding: boolean;
  onStartAdding: () => void;
  onDoneAdding: () => void;
}) {
  const query = useHabitsQuery();
  const outcomesQuery = useOutcomesQuery();
  const auth = useService(AuthService);
  const zone = auth.user?.timezone ?? 'UTC';
  const weekStartsOn = auth.user?.weekStartsOn === 0 ? 0 : 1;
  const today = todayYmd(zone);
  const [monthCursor, setMonthCursor] = useState(`${today.slice(0, 7)}-01`);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Habit | null>(null);
  const range = monthRange(monthCursor);
  const checkinsQuery = useQuery({
    queryKey: todayKeys.habitCheckins(range.from, range.to),
    queryFn: () => client.listHabitCheckins(range),
  });
  // trailing 92 days: powers streaks and the overview bar, independent of the visible month
  const statsRange = { from: addDaysYmd(today, -92), to: today };
  const statsQuery = useQuery({
    queryKey: todayKeys.habitCheckins(statsRange.from, statsRange.to),
    queryFn: () => client.listHabitCheckins(statsRange),
  });

  if (query.isPending) {
    return (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">…</p>
    );
  }

  const habits = query.data ?? [];
  const activeCount = habits.filter((habit) => habit.active).length;
  const visible = habits.filter((habit) =>
    filter === 'all' ? true : filter === 'active' ? habit.active : !habit.active,
  );
  const checkins = checkinsQuery.data?.items;
  const statsItems = statsQuery.data?.items;

  const pills: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: copy.filters.all, count: habits.length },
    { id: 'active', label: copy.filters.active, count: activeCount },
    { id: 'paused', label: copy.filters.paused, count: habits.length - activeCount },
  ];

  return (
    <div className="flex flex-col gap-6" data-region="habits-manage">
      <OverviewBar
        habits={habits}
        statsItems={statsItems}
        zone={zone}
        weekStartsOn={weekStartsOn}
        today={today}
      />

      {habits.length === 0 ? (
        <EmptyState onAdd={onStartAdding} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {pills.map((pill) => (
              <button
                key={pill.id}
                type="button"
                aria-pressed={filter === pill.id}
                onClick={() => setFilter(pill.id)}
                className={`inline-flex h-8 items-center rounded-full px-3.5 text-[length:var(--text-meta)] transition-[color,background-color] duration-[var(--ease-out)] ${
                  filter === pill.id
                    ? 'bg-accent-subtle font-semibold text-accent-deep'
                    : 'text-muted hover:bg-surface-muted hover:text-fg'
                }`}
              >
                {pill.label} <span className="ml-1 tabular-nums">{pill.count}</span>
              </button>
            ))}
            <div className="ml-auto">
              <HabitMonthNav monthCursor={monthCursor} today={today} onChange={setMonthCursor} />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-[length:var(--text-meta)] text-tertiary">
              {copy.filterEmpty}
            </p>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-2">
              {visible.map((habit) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  outcomes={outcomesQuery.data ?? []}
                  days={checkinsFor(checkins, habit.id)}
                  statsDays={checkinsFor(statsItems, habit.id)}
                  monthCursor={monthCursor}
                  weekStartsOn={weekStartsOn}
                  today={today}
                  createdOn={formatYmd(new Date(habit.createdAt), zone)}
                  onEdit={() => setEditing(habit)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {adding ? (
        <HabitDialog habit={null} outcomes={outcomesQuery.data ?? []} zone={zone} onClose={onDoneAdding} />
      ) : null}
      {editing ? (
        <HabitDialog
          habit={editing}
          outcomes={outcomesQuery.data ?? []}
          zone={zone}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
