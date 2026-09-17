import type { Habit, HabitCheckinDay } from '@vital/dto';
import { t } from '@/copy';
import { monthGrid, ymdParts } from '@/lib/calendar-grid';
import { habitTodayProgress } from '@/features/today';

const copy = t.settings.habits;

function dayLabel(ymd: string, done: number, total: number, state: 'done' | 'missed' | 'empty'): string {
  const m = String(Number(ymd.slice(5, 7)));
  const d = String(Number(ymd.slice(8)));
  if (state === 'done') {
    return copy.checkinDone
      .replace('{m}', m)
      .replace('{d}', d)
      .replace('{done}', String(done))
      .replace('{total}', String(total));
  }
  if (state === 'missed') {
    return copy.checkinMissed.replace('{m}', m).replace('{d}', d);
  }
  return copy.checkinEmpty.replace('{m}', m).replace('{d}', d);
}

export function HabitCheckinCalendar({
  habit,
  days,
  monthCursor,
  weekStartsOn,
  today,
  createdOn,
}: {
  habit: Habit;
  days: HabitCheckinDay[];
  monthCursor: string;
  weekStartsOn: 0 | 1;
  today: string;
  createdOn: string;
}) {
  const { y, m } = ymdParts(monthCursor);
  const cells = monthGrid(y, m, weekStartsOn);
  const weekday = t.todos.weekday;
  const labels =
    weekStartsOn === 1
      ? [weekday[1], weekday[2], weekday[3], weekday[4], weekday[5], weekday[6], weekday[0]]
      : weekday;
  const doneByDate = new Map(days.map((row) => [row.date, row.done]));
  const { total } = habitTodayProgress(habit);

  return (
    <div
      data-habit-calendar={habit.id}
      aria-label={copy.calendarAria.replace('{name}', habit.name)}
      className="mt-3 max-w-[20rem]"
    >
      <div className="grid grid-cols-7 justify-items-center text-center">
        {labels.map((label) => (
          <span key={label} className="pb-1 text-[10px] leading-4 text-muted">
            {label}
          </span>
        ))}
        {cells.map((ymd, index) => {
          if (ymd === null) return <span key={`e-${String(index)}`} className="h-8" />;
          const done = doneByDate.get(ymd) ?? 0;
          const isToday = ymd === today;
          const future = ymd > today;
          const beforeStart = ymd < createdOn;
          const complete = done > 0 && done >= total;
          const partial = done > 0 && done < total;
          const missed = !future && !beforeStart && done === 0 && ymd !== today;
          const state: 'done' | 'missed' | 'empty' = complete || partial ? 'done' : missed ? 'missed' : 'empty';
          const fill = complete ? 1 : partial ? Math.max(0.22, done / Math.max(total, 1)) : 0;
          return (
            <span
              key={ymd}
              data-checkin={ymd}
              data-checkin-done={String(done)}
              title={dayLabel(ymd, done, total, state)}
              aria-label={dayLabel(ymd, done, total, state)}
              aria-current={isToday ? 'date' : undefined}
              className="flex h-8 w-8 items-center justify-center"
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] tabular-nums ${
                  complete
                    ? 'bg-accent font-semibold text-on-accent'
                    : future || beforeStart
                      ? 'text-muted/40'
                      : isToday
                        ? 'ring-1 ring-accent/70 text-fg'
                        : missed
                          ? 'text-muted'
                          : 'text-fg'
                }`}
                style={
                  partial
                    ? {
                        backgroundColor: `color-mix(in srgb, var(--accent-primary) ${Math.round(fill * 100)}%, var(--bg-surface-muted))`,
                        color: 'var(--accent-primary)',
                        fontWeight: 600,
                      }
                    : undefined
                }
              >
                {Number(ymd.slice(8))}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
