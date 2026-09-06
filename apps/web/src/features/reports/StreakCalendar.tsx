import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReportHeatCell, ReportType } from '@vital/dto';
import { t } from '@/copy';
import { addMonthsYmd, ymdParts } from '@/lib/calendar-grid';
import { addDaysYmd, todayYmd } from '@/features/todos/model';
import { Icon } from '@/ui/icon';

function cellLabel(date: string, grain: 'day' | 'month' | 'year', wrote: boolean): string {
  const base =
    grain === 'year'
      ? `${date.slice(0, 4)}年`
      : grain === 'month'
        ? `${Number(date.slice(5, 7))}月`
        : `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
  return wrote ? `${base} · ${t.reports.wrote}` : base;
}

export function StreakCalendar({
  type,
  heatmap,
  grain,
  selectedStart,
  weekStartsOn,
  timeZone,
  onPick,
  onCursorMonth,
}: {
  type: ReportType;
  heatmap: ReportHeatCell[];
  grain: 'day' | 'month' | 'year';
  selectedStart?: string;
  weekStartsOn: 0 | 1;
  timeZone: string;
  onPick: (ymd: string) => void;
  onCursorMonth?: (ymd: string) => void;
}) {
  const today = todayYmd(timeZone);
  const maxCompleted = Math.max(1, ...heatmap.map((cell) => cell.completed));
  const weekday = t.todos.weekday;
  const labels =
    weekStartsOn === 1
      ? [weekday[1], weekday[2], weekday[3], weekday[4], weekday[5], weekday[6], weekday[0]]
      : weekday;

  if (grain === 'year') {
    return (
      <div className="rounded-2xl bg-surface p-5 shadow-[var(--shadow)]" data-testid="streak-calendar">
        <p className="mb-3 text-[length:var(--text-meta)] font-medium">{t.reports.yearly}</p>
        <div className="flex flex-col gap-2">
          {heatmap.map((cell) => {
            const sel = selectedStart === cell.date;
            const future = cell.date.slice(0, 4) > today.slice(0, 4);
            return (
              <button
                key={cell.date}
                type="button"
                disabled={future}
                onClick={() => onPick(cell.date)}
                aria-label={cellLabel(cell.date, 'year', cell.wrote)}
                className={`flex h-11 items-center justify-between rounded-2xl px-3 text-[length:var(--text-meta)] ${
                  sel
                    ? 'bg-accent text-on-accent'
                    : future
                      ? 'text-muted/40'
                      : 'bg-canvas text-fg hover:bg-surface-muted'
                }`}
              >
                <span>{cell.date.slice(0, 4)}年</span>
                <span className="flex items-center gap-2">
                  {cell.completed > 0 ? (
                    <span className={sel ? 'text-on-accent' : 'text-muted'}>{cell.completed}</span>
                  ) : null}
                  {cell.wrote ? (
                    <span className={`h-2 w-2 rounded-full ${sel ? 'bg-on-accent' : 'bg-accent'}`} />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[length:var(--text-caption)] text-muted">{t.reports.streakHint}</p>
      </div>
    );
  }

  if (grain === 'month') {
    const year = (heatmap[0]?.date ?? today).slice(0, 4);
    return (
      <div className="rounded-2xl bg-surface p-5 shadow-[var(--shadow)]" data-testid="streak-calendar">
        <p className="mb-3 text-[length:var(--text-meta)] font-medium">{year}年</p>
        <div className="grid grid-cols-3 gap-2">
          {heatmap.map((cell) => {
            const sel = selectedStart === cell.date;
            const future = cell.date > today;
            const fill = cell.completed > 0 ? 0.18 + (0.72 * cell.completed) / maxCompleted : 0;
            return (
              <button
                key={cell.date}
                type="button"
                disabled={future}
                onClick={() => onPick(cell.date)}
                aria-label={cellLabel(cell.date, 'month', cell.wrote)}
                className={`relative flex h-12 flex-col items-center justify-center rounded-2xl text-[length:var(--text-caption)] ${
                  sel ? 'bg-accent text-on-accent' : future ? 'text-muted/40' : 'text-fg'
                }`}
                style={
                  sel || future || fill === 0
                    ? undefined
                    : { backgroundColor: `color-mix(in srgb, var(--accent-primary) ${Math.round(fill * 100)}%, var(--bg-canvas))` }
                }
              >
                {Number(cell.date.slice(5, 7))}月
                {cell.wrote && !sel ? (
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" />
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[length:var(--text-caption)] text-muted">{t.reports.streakHint}</p>
      </div>
    );
  }

  const first = heatmap[0]?.date ?? `${today.slice(0, 7)}-01`;
  const { y, m } = ymdParts(first);
  const dowOffset = (() => {
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    let lead = firstDow - weekStartsOn;
    if (lead < 0) lead += 7;
    return lead;
  })();

  return (
    <div className="rounded-2xl bg-surface p-5 shadow-[var(--shadow)]" data-testid="streak-calendar">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted"
          onClick={() => onCursorMonth?.(addMonthsYmd(first, -1))}
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
          onClick={() => onCursorMonth?.(addMonthsYmd(first, 1))}
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
        {Array.from({ length: dowOffset }, (_, i) => (
          <span key={`e-${i}`} />
        ))}
        {heatmap.map((cell) => {
          const isToday = cell.date === today;
          const sel = selectedStart === cell.date;
          const inWeek =
            type === 'weekly' && selectedStart
              ? cell.date >= selectedStart && cell.date < addDaysYmd(selectedStart, 7)
              : false;
          const future = cell.date > today;
          const fill = cell.completed > 0 ? 0.2 + (0.7 * cell.completed) / maxCompleted : 0;
          return (
            <button
              key={cell.date}
              type="button"
              disabled={future}
              onClick={() => onPick(cell.date)}
              aria-label={cellLabel(cell.date, 'day', cell.wrote)}
              aria-current={isToday ? 'date' : undefined}
              className={`relative mx-auto flex h-9 w-9 items-center justify-center rounded-full text-[length:var(--text-caption)] ${
                sel
                  ? 'bg-accent text-on-accent'
                  : inWeek
                    ? 'bg-accent-subtle text-fg'
                    : future
                      ? 'text-muted/40'
                      : isToday
                        ? 'text-accent ring-1 ring-accent'
                        : 'text-fg'
              }`}
              style={
                sel || future || fill === 0
                  ? undefined
                  : {
                      backgroundColor: `color-mix(in srgb, var(--accent-primary) ${Math.round(fill * 100)}%, transparent)`,
                    }
              }
            >
              {Number(cell.date.slice(8))}
              {cell.wrote && !sel ? (
                <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-accent" />
              ) : null}
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
