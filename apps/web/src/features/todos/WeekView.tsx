import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { CalendarInstance } from '@vital/dto';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';
import { formatHumanDay } from './model';
import { priorityBarClass, PriorityMark } from './priority';
import { addDaysYmd, formatHm, formatYmd, todayYmd, weekdayInZone } from './model';

export function WeekView({
  days,
  instances,
  timeZone,
  composeDay,
  onSelectDay,
  onAddDay,
  onOpen,
}: {
  listId: string;
  days: string[];
  instances: CalendarInstance[];
  timeZone: string;
  composeDay?: string | null;
  onSelectDay: (ymd: string) => void;
  onAddDay: (ymd: string) => void;
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
  for (const list of byDay.values()) {
    list.sort((a, b) => {
      if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
      return a.occurrenceAt.localeCompare(b.occurrenceAt);
    });
  }

  const start = days[0] ?? today;
  const end = days[days.length - 1] ?? today;
  const heading = `${Number(start.slice(5, 7))}月${Number(start.slice(8))}日 – ${Number(end.slice(5, 7))}月${Number(end.slice(8))}日`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[length:var(--text-meta)] font-medium tracking-[-0.02em] text-fg">
          {heading}
        </p>
        <div className="flex items-center gap-0.5 rounded-2xl bg-surface p-0.5 shadow-[inset_0_0_0_1px_var(--border-subtle)]">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted hover:bg-surface-muted hover:text-fg"
            onClick={() => onSelectDay(addDaysYmd(start, -7))}
            aria-label={t.todos.weekPrev}
          >
            <Icon icon={ChevronLeft} size={16} />
          </button>
          <button
            type="button"
            className="h-8 rounded-xl px-3 text-[length:var(--text-caption)] text-muted hover:bg-surface-muted hover:text-fg"
            onClick={() => onSelectDay(today)}
          >
            {t.todos.weekThis}
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted hover:bg-surface-muted hover:text-fg"
            onClick={() => onSelectDay(addDaysYmd(start, 7))}
            aria-label={t.todos.weekNext}
          >
            <Icon icon={ChevronRight} size={16} />
          </button>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow)]">
        {days.map((ymd, index) => {
          const items = byDay.get(ymd) ?? [];
          const isToday = ymd === today;
          const composing = composeDay === ymd;
          const weekday = weekdayInZone(ymd, timeZone) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
          const weekend = weekday === 0 || weekday === 6;
          const label = t.todos.weekday[weekday];
          return (
            <section
              key={ymd}
              className={`group/day flex min-h-0 cursor-pointer flex-col px-1.5 py-3 ${
                index > 0 ? 'border-l border-border/70' : ''
              } ${isToday ? 'bg-accent-subtle/50' : composing ? 'bg-surface-muted/60' : ''}`}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => onAddDay(ymd)}
            >
              <h2 className="mb-2 flex flex-col items-center gap-1">
                <span
                  className={`text-[length:var(--text-caption)] ${
                    weekend ? 'text-muted/70' : 'text-muted'
                  }`}
                >
                  {label}
                </span>
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-[length:var(--text-meta)] font-medium ${
                    isToday
                      ? 'bg-accent text-on-accent'
                      : composing
                        ? 'bg-fg text-canvas'
                        : 'text-fg'
                  }`}
                >
                  {Number(ymd.slice(8))}
                </span>
              </h2>
              <div className="flex min-h-0 flex-1 flex-col gap-1">
                {items.map((item) => {
                  const time = item.isAllDay ? null : formatHm(item.occurrenceAt, timeZone);
                  const name = time ? `${time} ${item.title}` : item.title;
                  return (
                    <button
                      key={`${item.taskId}-${item.occurrenceAt}`}
                      type="button"
                      data-priority={item.priority}
                      className="flex w-full overflow-hidden rounded-lg bg-canvas text-left ring-1 ring-border/80 hover:ring-focus"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(item.taskId);
                      }}
                      aria-label={name}
                    >
                      <span className={`w-[3px] shrink-0 ${priorityBarClass(item.priority)}`} />
                      <span className="min-w-0 flex-1 px-1.5 py-1">
                        <span className="flex items-center gap-1">
                          <PriorityMark priority={item.priority} />
                          {time ? (
                            <span className="text-[11px] tabular-nums text-muted">{time}</span>
                          ) : (
                            <span className="text-[11px] text-muted">{t.todos.allDay}</span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-fg">
                          {item.title}
                        </span>
                      </span>
                    </button>
                  );
                })}
                <span className="mt-auto hidden items-center justify-center gap-1 rounded-lg py-1 text-[11px] text-muted group-hover/day:flex">
                  <Icon icon={Plus} size={12} />
                  {formatHumanDay(ymd, timeZone)}
                </span>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
