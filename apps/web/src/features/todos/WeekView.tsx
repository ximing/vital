import type { CalendarInstance } from '@vital/dto';
import { t } from '@/copy';
import { EmptyTasks } from './EmptyTasks';
import { addDaysYmd, formatHm, formatYmd, todayYmd, weekdayInZone } from './model';

export function WeekView({
  listId,
  days,
  instances,
  timeZone,
  onSelectDay,
  onOpen,
}: {
  listId: string;
  days: string[];
  instances: CalendarInstance[];
  timeZone: string;
  onSelectDay: (ymd: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const today = todayYmd(timeZone);
  const byDay = new Map<string, CalendarInstance[]>();
  for (const day of days) byDay.set(day, []);
  for (const inst of instances) {
    const ymd = formatYmd(new Date(inst.occurrenceAt), timeZone);
    const list = byDay.get(ymd);
    if (list) list.push(inst);
  }

  const hasAny = instances.length > 0;
  if (!hasAny) return <EmptyTasks listId={listId} kind="week" />;

  const start = days[0] ?? today;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pb-3">
        <button
          type="button"
          className="min-h-[var(--touch-min)] rounded-md px-3 text-[length:var(--text-meta)] text-muted hover:bg-surface-muted hover:text-fg"
          onClick={() => onSelectDay(addDaysYmd(start, -7))}
        >
          {t.todos.weekPrev}
        </button>
        <button
          type="button"
          className="min-h-[var(--touch-min)] rounded-md px-3 text-[length:var(--text-meta)] text-muted hover:bg-surface-muted hover:text-fg"
          onClick={() => onSelectDay(today)}
        >
          {t.todos.weekThis}
        </button>
        <button
          type="button"
          className="min-h-[var(--touch-min)] rounded-md px-3 text-[length:var(--text-meta)] text-muted hover:bg-surface-muted hover:text-fg"
          onClick={() => onSelectDay(addDaysYmd(start, 7))}
        >
          {t.todos.weekNext}
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-px overflow-auto bg-border px-4 pb-6">
        {days.map((ymd) => {
          const items = byDay.get(ymd) ?? [];
          const chips = items.filter((item) => item.isAllDay);
          const dots = items.filter((item) => !item.isAllDay);
          const isToday = ymd === today;
          const weekday = weekdayInZone(ymd, timeZone) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
          const label = t.todos.weekday[weekday];
          return (
            <section
              key={ymd}
              className={`min-h-[16rem] p-2 ${isToday ? 'bg-accent-subtle' : 'bg-surface'}`}
              aria-current={isToday ? 'date' : undefined}
            >
              <h2 className="flex items-baseline justify-between text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                <span>{label}</span>
                <span className={isToday ? 'text-accent' : ''}>{ymd.slice(8)}</span>
              </h2>
              <div className="mt-2 flex flex-col gap-1">
                {chips.map((chip) => (
                  <button
                    key={`${chip.taskId}-${chip.occurrenceAt}`}
                    type="button"
                    className="truncate rounded-full bg-accent-subtle px-2 py-1 text-left text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-fg"
                    onClick={() => onOpen(chip.taskId)}
                  >
                    {chip.title}
                  </button>
                ))}
                {dots.map((dot) => (
                  <button
                    key={`${dot.taskId}-${dot.occurrenceAt}`}
                    type="button"
                    className="flex items-center gap-2 text-left text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-fg"
                    onClick={() => onOpen(dot.taskId)}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                    <span className="text-muted">{formatHm(dot.occurrenceAt, timeZone)}</span>
                    <span className="truncate">{dot.title}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
