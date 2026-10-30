import { ChevronLeft, ChevronRight } from 'lucide-react';
import { observer, useService } from '@rabjs/react';
import { useLayoutEffect, useMemo, useRef, useState, type FC } from 'react';
import { t } from '@/copy';
import { useCalendarQuery } from '@/features/todos/queries';
import { todayYmd } from '@/features/todos/model';
import { AuthService } from '@/services/auth.service';
import { Icon } from '@/ui/icon';
import {
  placeSchedule,
  scheduleRangeIso,
  shiftScheduleCursor,
  type MonthPlacement,
  type ScheduleChip,
  type ScheduleView,
  type WeekPlacement,
} from './place';

function periodHeading(placement: WeekPlacement | MonthPlacement): string {
  if (placement.view === 'month') return `${placement.year}年${placement.month}月`;
  const start = placement.startYmd;
  const end = placement.endYmd;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDay(start, true)} – ${formatDay(end, !sameYear)}`;
}

function formatDay(ymd: string, withYear: boolean): string {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  return withYear ? `${year}年${month}月${day}日` : `${month}月${day}日`;
}

function Chip({ chip }: { chip: ScheduleChip }) {
  return (
    <span
      data-schedule-title={chip.title}
      className="mb-0.5 block truncate rounded-sm border-l-2 border-accent bg-surface-muted px-1 py-0.5 text-left text-[length:var(--text-caption)] leading-tight text-fg"
    >
      {chip.timeLabel !== null ? (
        <span className="mr-1 font-mono text-muted">{chip.timeLabel}</span>
      ) : null}
      {chip.title}
    </span>
  );
}

function DayNumber({ ymd, today }: { ymd: string; today: string }) {
  const day = Number(ymd.slice(8, 10));
  if (ymd === today) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[length:var(--text-meta)] font-medium text-on-accent">
        {day}
      </span>
    );
  }
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center text-[length:var(--text-meta)]">
      {day}
    </span>
  );
}

const WEEK_COLS = 'grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]';

function WeekGrid({ model, today }: { model: WeekPlacement; today: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = scroller.current;
    if (root === null) return;
    const row = root.querySelector<HTMLElement>('[data-schedule-hour="8"]');
    if (row === null) return;
    const top = row.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    root.scrollTop = top;
  }, [model.startYmd]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-region="schedule-week">
      <div className={`grid ${WEEK_COLS} shrink-0 border-b border-border`}>
        <div />
        {model.days.map((day) => {
          const weekend = day.weekday === 0 || day.weekday === 6;
          return (
            <div key={day.ymd} className="flex flex-col items-center border-l border-border py-2">
              <span
                className={`text-[length:var(--text-caption)] ${weekend ? 'text-muted/70' : 'text-muted'}`}
              >
                {t.todos.weekday[day.weekday]}
              </span>
              <DayNumber ymd={day.ymd} today={today} />
            </div>
          );
        })}
      </div>
      <div
        className={`grid ${WEEK_COLS} shrink-0 border-b border-border`}
        data-region="schedule-all-day"
      >
        <div className="px-2 py-1.5 font-mono text-[length:var(--text-caption)] text-muted">
          {t.schedule.allDay}
        </div>
        {model.days.map((day) => (
          <div
            key={day.ymd}
            data-schedule-all-day={day.ymd}
            className="min-h-8 border-l border-border px-1 py-1"
          >
            {day.allDay.map((chip) => (
              <Chip key={chip.key} chip={chip} />
            ))}
          </div>
        ))}
      </div>
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-y-auto"
        data-region="schedule-hours"
      >
        {model.days[0]?.hours.map((slot) => (
          <div
            key={slot.hour}
            data-schedule-hour={slot.hour}
            className={`grid ${WEEK_COLS} min-h-12 border-b border-border/70`}
          >
            <div className="whitespace-nowrap px-2 py-1 font-mono text-[length:var(--text-caption)] text-muted">
              {String(slot.hour).padStart(2, '0')}:00
            </div>
            {model.days.map((day) => (
              <div
                key={day.ymd}
                data-schedule-day={day.ymd}
                data-schedule-hour={slot.hour}
                className="border-l border-border/70 px-0.5 py-0.5"
              >
                {day.hours[slot.hour]?.items.map((chip) => (
                  <Chip key={chip.key} chip={chip} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthGrid({
  model,
  today,
  weekStartsOn,
}: {
  model: MonthPlacement;
  today: string;
  weekStartsOn: 0 | 1;
}) {
  const heads = weekStartsOn === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-region="schedule-month">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {heads.map((weekday) => (
          <div
            key={weekday}
            className="py-2 text-center text-[length:var(--text-caption)] text-muted"
          >
            {t.todos.weekday[weekday]}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {model.cells.map((cell) => (
          <div
            key={cell.ymd}
            data-schedule-date={cell.ymd}
            className="flex min-h-0 flex-col overflow-y-auto border-b border-l border-border px-1 py-1"
          >
            <span className={cell.inMonth ? '' : 'text-muted'}>
              <DayNumber ymd={cell.ymd} today={today} />
            </span>
            <div className="mt-0.5 flex min-h-0 flex-col">
              {cell.chips.map((chip) => (
                <Chip key={chip.key} chip={chip} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const SchedulePage: FC = observer(function SchedulePageContent() {
  const auth = useService(AuthService);
  const timeZone = auth.user?.timezone ?? 'Asia/Shanghai';
  const weekStartsOn = auth.user?.weekStartsOn === 0 ? 0 : 1;
  const today = todayYmd(timeZone);
  const [view, setView] = useState<ScheduleView>('week');
  const [cursor, setCursor] = useState(today);
  const range = useMemo(
    () => scheduleRangeIso(cursor, view, weekStartsOn, timeZone),
    [cursor, view, weekStartsOn, timeZone],
  );
  const calendar = useCalendarQuery(range.from, range.to);
  const placement = useMemo(
    () =>
      placeSchedule({
        occurrences: calendar.data ?? [],
        timeZone,
        weekStartsOn,
        cursorYmd: cursor,
        view,
      }),
    [calendar.data, timeZone, weekStartsOn, cursor, view],
  );
  const period =
    placement.view === 'week'
      ? placement.startYmd
      : `${placement.year}-${String(placement.month).padStart(2, '0')}`;
  const prevLabel = view === 'week' ? t.schedule.prevWeek : t.schedule.prevMonth;
  const nextLabel = view === 'week' ? t.schedule.nextWeek : t.schedule.nextMonth;

  return (
    <div
      data-region="schedule"
      data-schedule-view={view}
      data-schedule-period={period}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-canvas"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="font-display text-[length:var(--text-title)] font-semibold leading-none">
          {t.schedule.title}
        </h1>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label={prevLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
            onClick={() => setCursor((current) => shiftScheduleCursor(current, view, -1))}
          >
            <Icon icon={ChevronLeft} size={16} />
          </button>
          <button
            type="button"
            className="h-8 rounded-md px-2.5 text-[length:var(--text-meta)] text-muted hover:bg-surface-muted hover:text-fg"
            onClick={() => setCursor(todayYmd(timeZone))}
          >
            {t.schedule.today}
          </button>
          <button
            type="button"
            aria-label={nextLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
            onClick={() => setCursor((current) => shiftScheduleCursor(current, view, 1))}
          >
            <Icon icon={ChevronRight} size={16} />
          </button>
        </div>
        <p className="font-mono text-[length:var(--text-meta)] text-fg" data-schedule-heading>
          {periodHeading(placement)}
        </p>
        <div
          className="ml-auto flex items-center rounded-md bg-surface-muted p-0.5"
          role="group"
          aria-label={t.schedule.view}
        >
          <button
            type="button"
            aria-pressed={view === 'week'}
            className={`h-7 rounded-sm px-3 text-[length:var(--text-meta)] ${
              view === 'week' ? 'bg-surface text-fg shadow-[var(--shadow-xs)]' : 'text-muted'
            }`}
            onClick={() => setView('week')}
          >
            {t.schedule.week}
          </button>
          <button
            type="button"
            aria-pressed={view === 'month'}
            className={`h-7 rounded-sm px-3 text-[length:var(--text-meta)] ${
              view === 'month' ? 'bg-surface text-fg shadow-[var(--shadow-xs)]' : 'text-muted'
            }`}
            onClick={() => setView('month')}
          >
            {t.schedule.month}
          </button>
        </div>
      </header>
      {calendar.isError ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 text-[length:var(--text-meta)] text-muted">
          <span>{t.schedule.loadError}</span>
          <button
            type="button"
            className="text-fg underline-offset-2 hover:underline"
            onClick={() => void calendar.refetch()}
          >
            {t.schedule.retry}
          </button>
        </div>
      ) : null}
      {placement.view === 'week' ? (
        <WeekGrid model={placement} today={today} />
      ) : (
        <MonthGrid model={placement} today={today} weekStartsOn={weekStartsOn} />
      )}
    </div>
  );
});
