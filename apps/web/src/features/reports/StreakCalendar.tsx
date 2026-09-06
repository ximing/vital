import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReportListItem, ReportType } from '@vital/dto';
import { t } from '@/copy';
import { addMonthsYmd, monthGrid, ymdParts } from '@/lib/calendar-grid';
import { addDaysYmd, startOfWeekYmd, todayYmd } from '@/features/todos/model';
import { Icon } from '@/ui/icon';

function periodStartOf(type: ReportType, ymd: string, weekStartsOn: 0 | 1, timeZone: string): string {
  if (type === 'daily') return ymd;
  if (type === 'weekly') return startOfWeekYmd(ymd, weekStartsOn, timeZone);
  if (type === 'monthly') return `${ymd.slice(0, 7)}-01`;
  return `${ymd.slice(0, 4)}-01-01`;
}

function dayLabel(ymd: string, wrote: boolean): string {
  const base = `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8))}日`;
  return wrote ? `${base} · ${t.reports.wrote}` : base;
}

export function StreakCalendar({
  type,
  items,
  selectedStart,
  weekStartsOn,
  timeZone,
  onPick,
}: {
  type: ReportType;
  items: ReportListItem[];
  selectedStart?: string;
  weekStartsOn: 0 | 1;
  timeZone: string;
  onPick: (ymd: string) => void;
}) {
  const today = todayYmd(timeZone);
  const [cursor, setCursor] = useState((selectedStart ?? today).slice(0, 7) + '-01');
  const wrote = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.type !== type) continue;
      if (item.revision > 1) set.add(item.periodStart);
    }
    return set;
  }, [items, type]);

  const { y, m } = ymdParts(cursor);
  const cells = monthGrid(y, m, weekStartsOn);
  const weekday = t.todos.weekday;
  const labels =
    weekStartsOn === 1
      ? [weekday[1], weekday[2], weekday[3], weekday[4], weekday[5], weekday[6], weekday[0]]
      : weekday;

  if (type === 'monthly') {
    return (
      <div className="rounded-2xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--border-subtle)]" data-testid="streak-calendar">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted"
            onClick={() => setCursor(padYear(y - 1))}
            aria-label={t.todos.weekPrev}
          >
            <Icon icon={ChevronLeft} size={16} />
          </button>
          <p className="text-[length:var(--text-meta)] font-medium">{y}年</p>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted"
            onClick={() => setCursor(padYear(y + 1))}
            aria-label={t.todos.weekNext}
          >
            <Icon icon={ChevronRight} size={16} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 12 }, (_, i) => {
            const start = `${y}-${String(i + 1).padStart(2, '0')}-01`;
            const lit = wrote.has(start);
            const sel = selectedStart === start;
            const future = start > today.slice(0, 7) + '-01' && start > today;
            return (
              <button
                key={start}
                type="button"
                disabled={future}
                onClick={() => onPick(start)}
                aria-label={`${i + 1}月${lit ? ` · ${t.reports.wrote}` : ''}`}
                className={`flex h-12 flex-col items-center justify-center rounded-2xl text-[length:var(--text-caption)] ${
                  sel
                    ? 'bg-accent text-on-accent'
                    : lit
                      ? 'bg-accent-subtle text-fg'
                      : future
                        ? 'text-muted/40'
                        : 'bg-canvas text-fg hover:bg-surface-muted'
                }`}
              >
                {i + 1}月
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (type === 'yearly') {
    const years = Array.from({ length: 6 }, (_, i) => y - 4 + i);
    return (
      <div className="rounded-2xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--border-subtle)]" data-testid="streak-calendar">
        <p className="mb-3 text-[length:var(--text-meta)] font-medium">{t.reports.yearly}</p>
        <div className="flex flex-col gap-2">
          {years.map((year) => {
            const start = `${year}-01-01`;
            const lit = wrote.has(start);
            const sel = selectedStart === start;
            const future = year > Number(today.slice(0, 4));
            return (
              <button
                key={year}
                type="button"
                disabled={future}
                onClick={() => onPick(start)}
                aria-label={`${year}年${lit ? ` · ${t.reports.wrote}` : ''}`}
                className={`flex h-11 items-center justify-between rounded-2xl px-3 text-[length:var(--text-meta)] ${
                  sel
                    ? 'bg-accent text-on-accent'
                    : lit
                      ? 'bg-accent-subtle text-fg'
                      : future
                        ? 'text-muted/40'
                        : 'bg-canvas text-fg hover:bg-surface-muted'
                }`}
              >
                <span>{year}年</span>
                {lit ? (
                  <span className={`h-2 w-2 rounded-full ${sel ? 'bg-on-accent' : 'bg-accent'}`} />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const weekEnd = selectedStart ? addDaysYmd(selectedStart, 7) : '';

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[inset_0_0_0_1px_var(--border-subtle)]" data-testid="streak-calendar">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted"
          onClick={() => setCursor(addMonthsYmd(cursor, -1))}
          aria-label={t.todos.weekPrev}
        >
          <Icon icon={ChevronLeft} size={16} />
        </button>
        <p className="text-[length:var(--text-meta)] font-medium">
          {y}年{m}月
        </p>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted"
          onClick={() => setCursor(addMonthsYmd(cursor, 1))}
          aria-label={t.todos.weekNext}
        >
          <Icon icon={ChevronRight} size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {labels.map((label) => (
          <span key={label} className="pb-1 text-[length:var(--text-caption)] text-muted">
            {label}
          </span>
        ))}
        {cells.map((ymd, i) => {
          if (ymd === null) return <span key={`e-${i}`} />;
          const start = periodStartOf(type, ymd, weekStartsOn, timeZone);
          const lit = wrote.has(start);
          const isToday = ymd === today;
          const inWeek = type === 'weekly' && selectedStart ? ymd >= selectedStart && ymd < weekEnd : false;
          const sel = type === 'weekly' ? ymd === selectedStart : selectedStart === start;
          const future = ymd > today;
          return (
            <button
              key={ymd}
              type="button"
              disabled={future}
              onClick={() => onPick(ymd)}
              aria-label={dayLabel(ymd, lit)}
              aria-current={isToday ? 'date' : undefined}
              className={`relative mx-auto flex h-9 w-9 items-center justify-center text-[length:var(--text-caption)] ${
                type === 'weekly' && inWeek
                  ? `bg-accent-subtle text-fg ${ymd === selectedStart ? 'rounded-l-full' : ''} ${
                      ymd === addDaysYmd(selectedStart ?? ymd, 6) ? 'rounded-r-full' : ''
                    }`
                  : 'rounded-full'
              } ${
                sel
                  ? 'rounded-full bg-accent text-on-accent'
                  : lit && !inWeek
                    ? 'rounded-full bg-accent-subtle text-fg'
                    : isToday
                      ? 'rounded-full text-accent ring-1 ring-accent'
                      : future
                        ? 'text-muted/40'
                        : 'rounded-full text-fg hover:bg-surface-muted'
              }`}
            >
              {Number(ymd.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
        {t.reports.streakHint}
      </p>
    </div>
  );
}

function padYear(y: number): string {
  return `${y}-01-01`;
}
