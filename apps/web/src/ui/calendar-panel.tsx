import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/copy';
import {
  decadeStart,
  monthGrid,
  padYmd,
  shiftCalendarCursor,
  yearPanelYears,
  ymdParts,
  type CalendarView,
} from '@/lib/calendar-grid';
import { Icon } from '@/ui/icon';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const NAV_BTN =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-fg';

const HEADER_BTN =
  'rounded-md px-1.5 py-0.5 text-[length:var(--text-meta)] font-medium text-fg hover:bg-surface-muted';

function stepLabels(view: CalendarView): {
  innerPrev: string;
  innerNext: string;
  superPrev: string;
  superNext: string;
} {
  if (view === 'year') {
    return {
      innerPrev: t.calendar.prevDecade,
      innerNext: t.calendar.nextDecade,
      superPrev: t.calendar.prevCentury,
      superNext: t.calendar.nextCentury,
    };
  }
  if (view === 'month') {
    return {
      innerPrev: t.calendar.prevYear,
      innerNext: t.calendar.nextYear,
      superPrev: t.calendar.prevDecade,
      superNext: t.calendar.nextDecade,
    };
  }
  return {
    innerPrev: t.calendar.prevMonth,
    innerNext: t.calendar.nextMonth,
    superPrev: t.calendar.prevYear,
    superNext: t.calendar.nextYear,
  };
}

function cellTone(selected: boolean, current: boolean, muted = false): string {
  if (selected) return 'bg-accent text-on-accent';
  if (current) return 'text-accent ring-1 ring-accent';
  if (muted) return 'text-muted hover:bg-surface-muted';
  return 'text-fg hover:bg-surface-muted';
}

export function CalendarPanel({
  selectedYmd,
  today,
  weekStartsOn,
  onPickDay,
}: {
  selectedYmd: string;
  today: string;
  weekStartsOn: 0 | 1;
  onPickDay: (ymd: string) => void;
}) {
  const [view, setView] = useState<CalendarView>('date');
  const [monthCursor, setMonthCursor] = useState(() => `${(selectedYmd || today).slice(0, 7)}-01`);
  const { y, m } = ymdParts(monthCursor);
  const selected = selectedYmd === '' ? null : ymdParts(selectedYmd);
  const todayParts = ymdParts(today);
  const labels = stepLabels(view);
  const decade = decadeStart(y);
  const weekday = t.todos.weekday;
  const dow =
    weekStartsOn === 1
      ? [weekday[1], weekday[2], weekday[3], weekday[4], weekday[5], weekday[6], weekday[0]]
      : weekday;
  const days = monthGrid(y, m, weekStartsOn);
  const years = yearPanelYears(y);

  function shift(step: 'inner' | 'super', dir: -1 | 1) {
    setMonthCursor(shiftCalendarCursor(monthCursor, view, step, dir));
  }

  function pickYear(year: number) {
    setMonthCursor(padYmd(year, m, 1));
    setView('month');
  }

  function pickMonth(month: number) {
    setMonthCursor(padYmd(y, month, 1));
    setView('date');
  }

  return (
    <div data-testid={`calendar-view-${view}`}>
      <div className="mb-2 flex items-center">
        <button type="button" className={NAV_BTN} aria-label={labels.superPrev} onClick={() => shift('super', -1)}>
          <Icon icon={ChevronsLeft} size={16} />
        </button>
        <button type="button" className={NAV_BTN} aria-label={labels.innerPrev} onClick={() => shift('inner', -1)}>
          <Icon icon={ChevronLeft} size={16} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
          {view === 'year' ? (
            <p className="text-[length:var(--text-meta)] font-medium tabular-nums">
              {t.calendar.decade.replace('{from}', String(decade)).replace('{to}', String(decade + 9))}
            </p>
          ) : (
            <>
              <button
                type="button"
                className={HEADER_BTN}
                aria-label={t.calendar.selectYear}
                onClick={() => setView('year')}
              >
                {t.calendar.year.replace('{y}', String(y))}
              </button>
              {view === 'date' ? (
                <button
                  type="button"
                  className={HEADER_BTN}
                  aria-label={t.calendar.selectMonth}
                  onClick={() => setView('month')}
                >
                  {t.calendar.month.replace('{m}', String(m))}
                </button>
              ) : null}
            </>
          )}
        </div>
        <button type="button" className={NAV_BTN} aria-label={labels.innerNext} onClick={() => shift('inner', 1)}>
          <Icon icon={ChevronRight} size={16} />
        </button>
        <button type="button" className={NAV_BTN} aria-label={labels.superNext} onClick={() => shift('super', 1)}>
          <Icon icon={ChevronsRight} size={16} />
        </button>
      </div>

      {view === 'date' ? (
        <div className="grid grid-cols-7 gap-y-1 text-center text-[length:var(--text-caption)] text-muted">
          {dow.map((label) => (
            <span key={label}>{label}</span>
          ))}
          {days.map((ymd, i) => {
            if (ymd === null) return <span key={`e-${i}`} />;
            const isToday = ymd === today;
            const isSel = ymd === selectedYmd;
            return (
              <button
                key={ymd}
                type="button"
                aria-label={`${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8))}日`}
                aria-current={isToday ? 'date' : undefined}
                onClick={() => onPickDay(ymd)}
                className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[length:var(--text-caption)] ${cellTone(isSel, isToday)}`}
              >
                {Number(ymd.slice(8))}
              </button>
            );
          })}
        </div>
      ) : null}

      {view === 'month' ? (
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((month) => {
            const isSel = selected !== null && selected.y === y && selected.m === month;
            const isCurrent = todayParts.y === y && todayParts.m === month;
            return (
              <button
                key={month}
                type="button"
                aria-pressed={isSel}
                onClick={() => pickMonth(month)}
                className={`flex h-10 items-center justify-center rounded-md text-[length:var(--text-meta)] ${cellTone(isSel, isCurrent)}`}
              >
                {t.calendar.month.replace('{m}', String(month))}
              </button>
            );
          })}
        </div>
      ) : null}

      {view === 'year' ? (
        <div className="grid grid-cols-3 gap-1">
          {years.map((year) => {
            const inDecade = year >= decade && year <= decade + 9;
            const isSel = selected !== null && selected.y === year;
            const isCurrent = todayParts.y === year;
            return (
              <button
                key={year}
                type="button"
                aria-pressed={isSel}
                onClick={() => pickYear(year)}
                className={`flex h-10 items-center justify-center rounded-md text-[length:var(--text-meta)] tabular-nums ${cellTone(isSel, isCurrent, !inDecade)}`}
              >
                {t.calendar.year.replace('{y}', String(year))}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
