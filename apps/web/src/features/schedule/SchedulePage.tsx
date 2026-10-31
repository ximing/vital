import { ChevronLeft, ChevronRight } from 'lucide-react';
import { observer, useService } from '@rabjs/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC } from 'react';
import { t } from '@/copy';
import {
  OPEN_QUICK_CREATE_EVENT,
  QUICK_CREATE_CLOSED_EVENT,
  TodosUiService,
  closeQuickCreate,
  isQuickCreatePin,
  openQuickCreate,
  todayYmd,
} from '@/features/todos';
import { useCalendarQuery, useTodoActions } from '@/features/todos/queries';
import { AuthService } from '@/services/auth.service';
import { Icon } from '@/ui/icon';
import { Overlay } from '@/ui/overlay';
import {
  QUARTER_MINUTES,
  scheduleDraftFromRange,
  scheduleRangeHitsCell,
  scheduleRangeLabel,
  type DayCell,
  type HourCell,
  type ScheduleCreateRange,
  type SlotMinute,
} from './gesture';
import {
  monthCellPreview,
  placeSchedule,
  scheduleNowMinute,
  scheduleRangeIso,
  scheduleScrollHour,
  shiftScheduleCursor,
  type MonthPlacement,
  type ScheduleChip,
  type ScheduleView,
  type WeekBlock,
  type WeekPlacement,
} from './place';
import { ScheduleDetail } from './ScheduleDetail';
import { useScheduleGesture, type ScheduleTimeEdit } from './use-schedule-gesture';

function periodHeading(placement: WeekPlacement | MonthPlacement): string {
  if (placement.view === 'month') return `${placement.year}年${placement.month}月`;
  if (placement.view === 'day') return formatDay(placement.startYmd, true);
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

function Chip({
  chip,
  onOpen,
  consumeMoved,
}: {
  chip: ScheduleChip;
  onOpen: (taskId: string) => void;
  consumeMoved: () => boolean;
}) {
  const label = chip.timeLabel !== null ? `${chip.timeLabel} ${chip.title}` : chip.title;
  return (
    <button
      type="button"
      data-schedule-title={chip.title}
      data-schedule-task={chip.taskId}
      data-schedule-start={chip.startAt}
      data-schedule-due={chip.dueAt}
      data-schedule-all-day-item={chip.isAllDay ? 'true' : 'false'}
      data-schedule-span-start={chip.spanStartYmd}
      data-schedule-span-end={chip.spanEndYmd}
      data-schedule-locked={chip.locked ? 'true' : undefined}
      aria-label={label}
      className={`relative z-[3] mb-0.5 block w-full truncate rounded-sm border-l-2 border-accent bg-surface-muted px-1 py-0.5 text-left text-[length:var(--text-caption)] leading-tight text-fg ${
        chip.locked ? '' : 'cursor-grab'
      }`}
      onClick={(event) => {
        event.stopPropagation();
        if (consumeMoved()) return;
        onOpen(chip.taskId);
      }}
    >
      {chip.timeLabel !== null ? (
        <span className="mr-1 font-mono text-muted">{chip.timeLabel}</span>
      ) : null}
      {chip.title}
    </button>
  );
}

function Block({
  block,
  columnYmd,
  onOpen,
  consumeMoved,
}: {
  block: WeekBlock;
  columnYmd: string;
  onOpen: (taskId: string) => void;
  consumeMoved: () => boolean;
}) {
  const day = 24 * 60;
  const movable = !block.locked;
  return (
    <div
      data-schedule-task={block.taskId}
      data-schedule-start={block.startAt}
      data-schedule-due={block.dueAt}
      data-schedule-all-day-item="false"
      data-schedule-span-start={columnYmd}
      data-schedule-span-end={columnYmd}
      data-schedule-column={columnYmd}
      data-schedule-locked={block.locked ? 'true' : undefined}
      className="pointer-events-auto absolute z-[1] min-h-6 overflow-hidden rounded-sm border-l-2 border-accent bg-accent-subtle text-[length:var(--text-caption)] leading-tight text-fg"
      style={{
        top: `${(block.startMinute / day) * 100}%`,
        height: `${((block.endMinute - block.startMinute) / day) * 100}%`,
        left: `calc(${block.lane} * 100% / ${block.laneCount})`,
        width: `calc(100% / ${block.laneCount} - 2px)`,
      }}
    >
      <button
        type="button"
        data-schedule-title={block.title}
        data-schedule-span={`${block.startMinute}-${block.endMinute}`}
        aria-label={`${block.timeLabel} ${block.title}`}
        className={`block h-full w-full truncate px-1 py-0.5 text-left ${movable ? 'cursor-grab' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          if (consumeMoved()) return;
          onOpen(block.taskId);
        }}
      >
        <span className="mr-1 font-mono text-muted">{block.timeLabel}</span>
        {block.title}
      </button>
      {movable && block.resizeStart ? (
        <div
          data-schedule-resize="start"
          className="absolute inset-x-0 top-0 z-[2] h-2 cursor-ns-resize"
        />
      ) : null}
      {movable && block.resizeEnd ? (
        <div
          data-schedule-resize="end"
          className="absolute inset-x-0 bottom-0 z-[2] h-2 cursor-ns-resize"
        />
      ) : null}
    </div>
  );
}

function DayNumber({
  ymd,
  today,
  onOpenDay,
}: {
  ymd: string;
  today: string;
  onOpenDay: (ymd: string) => void;
}) {
  const day = Number(ymd.slice(8, 10));
  return (
    <button
      type="button"
      data-schedule-day-link={ymd}
      aria-label={formatDay(ymd, true)}
      className={
        ymd === today
          ? 'inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[length:var(--text-meta)] font-medium text-on-accent'
          : 'inline-flex h-7 w-7 items-center justify-center text-[length:var(--text-meta)]'
      }
      onClick={(event) => {
        event.stopPropagation();
        onOpenDay(ymd);
      }}
    >
      {day}
    </button>
  );
}

const WEEK_COLS = 'grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]';

function quarterMinute(timeLabel: string | null): number {
  if (timeLabel === null || timeLabel.length < 5) return 0;
  const minute = Number(timeLabel.slice(3, 5));
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return 0;
  return Math.floor(minute / 15) * 15;
}

function selectedProps(on: boolean): { 'data-schedule-selected'?: 'true' } {
  return on ? { 'data-schedule-selected': 'true' } : {};
}

function cellClass(base: string, selected: boolean): string {
  return selected ? `${base} bg-accent-subtle` : base;
}

function cellHits(highlights: readonly ScheduleCreateRange[], cell: HourCell | DayCell): boolean {
  return highlights.some((range) => scheduleRangeHitsCell(range, cell));
}

function QuarterRow({
  days,
  hour,
  minute,
  highlights,
  cols,
  onOpen,
  consumeMoved,
}: {
  days: WeekPlacement['days'];
  hour: number;
  minute: SlotMinute;
  highlights: readonly ScheduleCreateRange[];
  cols: string;
  onOpen: (taskId: string) => void;
  consumeMoved: () => boolean;
}) {
  return (
    <div
      data-schedule-hour={hour}
      data-schedule-minute={minute}
      className={`grid ${cols} min-h-6 border-b ${
        minute === 45 ? 'border-border' : 'border-border/40'
      }`}
    >
      <div className="whitespace-nowrap px-2 pt-0.5 font-mono text-[length:var(--text-caption)] leading-none text-muted">
        {minute === 0 ? `${String(hour).padStart(2, '0')}:00` : ''}
      </div>
      {days.map((day) => {
        const cell: HourCell = { kind: 'hour', ymd: day.ymd, hour, minute };
        const selected = cellHits(highlights, cell);
        const chips = (day.hours[hour]?.items ?? []).filter(
          (chip) => quarterMinute(chip.timeLabel) === minute,
        );
        return (
          <div
            key={day.ymd}
            data-schedule-day={day.ymd}
            data-schedule-hour={hour}
            data-schedule-minute={minute}
            {...selectedProps(selected)}
            className={cellClass('border-l border-border/40 px-0.5', selected)}
          >
            {chips.map((chip) => (
              <Chip key={chip.key} chip={chip} onOpen={onOpen} consumeMoved={consumeMoved} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function WeekGrid({
  model,
  today,
  timeZone,
  draft,
  onDraft,
  onEdit,
  onOpen,
  onOpenDay,
}: {
  model: WeekPlacement;
  today: string;
  timeZone: string;
  draft: ScheduleCreateRange | null;
  onDraft: (range: ScheduleCreateRange) => void;
  onEdit: (edit: ScheduleTimeEdit) => void;
  onOpen: (taskId: string) => void;
  onOpenDay: (ymd: string) => void;
}) {
  const gesture = useScheduleGesture(timeZone, draft !== null, onDraft, onEdit);
  const highlights = gesture.highlights.length > 0 ? gesture.highlights : draft === null ? [] : [draft];
  const cols = model.days.length === 1 ? 'grid-cols-[3.5rem_minmax(0,1fr)]' : WEEK_COLS;
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const anchorHour = scheduleScrollHour(timeZone, now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  useLayoutEffect(() => {
    const root = scroller.current;
    if (root === null) return;
    const hour = scheduleScrollHour(timeZone);
    let aligned = false;
    const align = (): boolean => {
      if (root.clientHeight <= 0) return false;
      const row = root.querySelector<HTMLElement>(
        `[data-schedule-hour="${hour}"][data-schedule-minute="0"]`,
      );
      if (row === null) return false;
      const top =
        row.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      root.scrollTop = top;
      return hour === 0 || root.scrollTop > 0;
    };
    aligned = align();
    if (aligned) return;
    const observer = new ResizeObserver(() => {
      if (align()) observer.disconnect();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [model.startYmd, timeZone]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-region={model.view === 'day' ? 'schedule-day' : 'schedule-week'}
      onPointerDown={gesture.onPointerDown}
    >
      <div className={`grid ${cols} shrink-0 border-b border-border`}>
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
              <DayNumber ymd={day.ymd} today={today} onOpenDay={onOpenDay} />
            </div>
          );
        })}
      </div>
      <div
        className={`grid ${cols} shrink-0 border-b border-border`}
        data-region="schedule-all-day"
      >
        <div className="px-2 py-1.5 font-mono text-[length:var(--text-caption)] text-muted">
          {t.schedule.allDay}
        </div>
        {model.days.map((day) => {
          const cell: DayCell = { kind: 'day', ymd: day.ymd };
          const selected = cellHits(highlights, cell);
          return (
            <div
              key={day.ymd}
              data-schedule-all-day={day.ymd}
              {...selectedProps(selected)}
              className={cellClass('min-h-8 border-l border-border px-1 py-1', selected)}
            >
              {day.allDay.map((chip) => (
                <Chip key={chip.key} chip={chip} onOpen={onOpen} consumeMoved={gesture.consumeMoved} />
              ))}
            </div>
          );
        })}
      </div>
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-y-auto"
        data-region="schedule-hours"
        data-schedule-anchor={anchorHour}
      >
        <div className="relative">
          {model.days[0]?.hours.flatMap((slot) =>
            QUARTER_MINUTES.map((minute) => (
              <QuarterRow
                key={`${slot.hour}-${minute}`}
                days={model.days}
                hour={slot.hour}
                minute={minute}
                highlights={highlights}
                cols={cols}
                onOpen={onOpen}
                consumeMoved={gesture.consumeMoved}
              />
            )),
          )}
          <div className={`pointer-events-none absolute inset-0 grid ${cols}`}>
            <div />
            {model.days.map((day) => (
              <div key={day.ymd} className="relative overflow-hidden">
                {day.ymd === today ? (
                  <div
                    data-schedule-now=""
                    className="pointer-events-none absolute right-0 left-0 z-[2] border-t border-accent"
                    style={{ top: `${(scheduleNowMinute(timeZone, now) / (24 * 60)) * 100}%` }}
                  />
                ) : null}
                {day.blocks.map((block) => (
                  <Block
                    key={block.key}
                    block={block}
                    columnYmd={day.ymd}
                    onOpen={onOpen}
                    consumeMoved={gesture.consumeMoved}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  model,
  today,
  weekStartsOn,
  timeZone,
  draft,
  onDraft,
  onEdit,
  onOpen,
  onOpenDay,
}: {
  model: MonthPlacement;
  today: string;
  weekStartsOn: 0 | 1;
  timeZone: string;
  draft: ScheduleCreateRange | null;
  onDraft: (range: ScheduleCreateRange) => void;
  onEdit: (edit: ScheduleTimeEdit) => void;
  onOpen: (taskId: string) => void;
  onOpenDay: (ymd: string) => void;
}) {
  const gesture = useScheduleGesture(timeZone, draft !== null, onDraft, onEdit);
  const highlights = gesture.highlights.length > 0 ? gesture.highlights : draft === null ? [] : [draft];
  const [more, setMore] = useState<{
    ymd: string;
    chips: ScheduleChip[];
    top: number;
    left: number;
  } | null>(null);
  const heads = weekStartsOn === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-region="schedule-month"
      onPointerDown={gesture.onPointerDown}
    >
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
        {model.cells.map((cell) => {
          const day: DayCell = { kind: 'day', ymd: cell.ymd };
          const selected = cellHits(highlights, day);
          return (
            <div
              key={cell.ymd}
              data-schedule-date={cell.ymd}
              {...selectedProps(selected)}
              className={cellClass(
                'flex min-h-0 flex-col overflow-hidden border-b border-l border-border px-1 py-1',
                selected,
              )}
            >
              <span className={`shrink-0 ${cell.inMonth ? '' : 'text-muted'}`}>
                <DayNumber ymd={cell.ymd} today={today} onOpenDay={onOpenDay} />
              </span>
              <MonthChips
                chips={cell.chips}
                onOpen={onOpen}
                consumeMoved={gesture.consumeMoved}
                onMore={(chips, rect) =>
                  setMore({ ymd: cell.ymd, chips, top: rect.bottom + 4, left: rect.left })
                }
              />
            </div>
          );
        })}
      </div>
      {more !== null ? (
        <Overlay
          tone="transparent"
          onClose={() => setMore(null)}
          closeOnBackdrop
          closeOnEscape
          backdropEvent="mousedown"
        >
          <div
            data-region="schedule-more"
            className="fixed max-h-72 w-60 overflow-y-auto rounded-lg border border-border bg-surface p-2 shadow-[var(--shadow)]"
            style={{
              top: Math.min(more.top, window.innerHeight - 288),
              left: Math.min(more.left, window.innerWidth - 248),
            }}
          >
            <p className="eyebrow mb-1">{formatDay(more.ymd, false)}</p>
            {more.chips.map((chip) => (
              <Chip
                key={chip.key}
                chip={chip}
                consumeMoved={gesture.consumeMoved}
                onOpen={(taskId) => {
                  setMore(null);
                  onOpen(taskId);
                }}
              />
            ))}
          </div>
        </Overlay>
      ) : null}
    </div>
  );
}

function MonthChips({
  chips,
  onOpen,
  consumeMoved,
  onMore,
}: {
  chips: ScheduleChip[];
  onOpen: (taskId: string) => void;
  consumeMoved: () => boolean;
  onMore: (hidden: ScheduleChip[], rect: DOMRect) => void;
}) {
  const preview = monthCellPreview(chips);
  return (
    <div className="mt-0.5 flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 overflow-hidden">
        {preview.shown.map((chip) => (
          <Chip key={chip.key} chip={chip} onOpen={onOpen} consumeMoved={consumeMoved} />
        ))}
      </div>
      {preview.hidden.length > 0 ? (
        <button
          type="button"
          data-schedule-more=""
          className="mt-0.5 shrink-0 truncate px-1 text-left text-[length:var(--text-caption)] text-accent"
          onClick={(event) => {
            event.stopPropagation();
            onMore(preview.hidden, event.currentTarget.getBoundingClientRect());
          }}
        >
          {t.schedule.more}
        </button>
      ) : null}
    </div>
  );
}

export const SchedulePage: FC = observer(function SchedulePageContent() {
  const auth = useService(AuthService);
  const todos = useService(TodosUiService);
  const timeZone = auth.user?.timezone ?? 'Asia/Shanghai';
  const weekStartsOn = auth.user?.weekStartsOn === 0 ? 0 : 1;
  const today = todayYmd(timeZone);
  const [view, setView] = useState<ScheduleView>('week');
  const [cursor, setCursor] = useState(today);
  const [draft, setDraft] = useState<ScheduleCreateRange | null>(null);
  const range = useMemo(
    () => scheduleRangeIso(cursor, view, weekStartsOn, timeZone),
    [cursor, view, weekStartsOn, timeZone],
  );
  const calendar = useCalendarQuery(range.from, range.to);
  const placement = useMemo(
    () =>
      placeSchedule({
        occurrences: (calendar.data ?? []).map((item) => ({
          taskId: item.taskId,
          title: item.title,
          occurrenceAt: item.occurrenceAt,
          endsAt: item.endsAt,
          isAllDay: item.isAllDay,
          habit: item.habitId !== null,
          locked: item.calendarKey != null && item.calendarKey !== '',
        })),
        timeZone,
        weekStartsOn,
        cursorYmd: cursor,
        view,
      }),
    [calendar.data, timeZone, weekStartsOn, cursor, view],
  );
  const period =
    placement.view === 'month'
      ? `${placement.year}-${String(placement.month).padStart(2, '0')}`
      : placement.startYmd;
  const prevLabel =
    view === 'day' ? t.schedule.prevDay : view === 'week' ? t.schedule.prevWeek : t.schedule.prevMonth;
  const nextLabel =
    view === 'day' ? t.schedule.nextDay : view === 'week' ? t.schedule.nextWeek : t.schedule.nextMonth;

  useEffect(() => {
    function onOpen(event: Event): void {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      if (!isQuickCreatePin(detail)) setDraft(null);
    }
    function onClosed(): void {
      setDraft(null);
    }
    window.addEventListener(OPEN_QUICK_CREATE_EVENT, onOpen);
    window.addEventListener(QUICK_CREATE_CLOSED_EVENT, onClosed);
    return () => {
      window.removeEventListener(OPEN_QUICK_CREATE_EVENT, onOpen);
      window.removeEventListener(QUICK_CREATE_CLOSED_EVENT, onClosed);
    };
  }, []);

  const openTask = useCallback(
    (taskId: string): void => {
      todos.openDetail(taskId);
    },
    [todos],
  );

  const onDraft = useCallback((range: ScheduleCreateRange): void => {
    setDraft(range);
    openQuickCreate({
      pinSchedule: true,
      draft: scheduleDraftFromRange(range),
      rangeLabel: scheduleRangeLabel(range),
    });
  }, []);

  const { patch } = useTodoActions();
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const onEdit = useCallback((edit: ScheduleTimeEdit): void => {
    patchRef.current.mutate({
      id: edit.taskId,
      input: { startAt: edit.startAt, dueAt: edit.dueAt, isAllDay: edit.isAllDay },
    });
  }, []);

  function moveCursor(next: string): void {
    if (draft !== null) closeQuickCreate();
    setDraft(null);
    setCursor(next);
  }

  function moveView(next: ScheduleView): void {
    if (draft !== null) closeQuickCreate();
    setDraft(null);
    setView(next);
  }

  function openDay(ymd: string): void {
    if (draft !== null) closeQuickCreate();
    setDraft(null);
    setCursor(ymd);
    setView('day');
  }

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
            onClick={() => moveCursor(shiftScheduleCursor(cursor, view, -1))}
          >
            <Icon icon={ChevronLeft} size={16} />
          </button>
          <button
            type="button"
            className="h-8 rounded-md px-2.5 text-[length:var(--text-meta)] text-muted hover:bg-surface-muted hover:text-fg"
            onClick={() => moveCursor(todayYmd(timeZone))}
          >
            {t.schedule.today}
          </button>
          <button
            type="button"
            aria-label={nextLabel}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
            onClick={() => moveCursor(shiftScheduleCursor(cursor, view, 1))}
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
            aria-pressed={view === 'day'}
            className={`h-7 rounded-sm px-3 text-[length:var(--text-meta)] ${
              view === 'day' ? 'bg-surface text-fg shadow-[var(--shadow-xs)]' : 'text-muted'
            }`}
            onClick={() => moveView('day')}
          >
            {t.schedule.day}
          </button>
          <button
            type="button"
            aria-pressed={view === 'week'}
            className={`h-7 rounded-sm px-3 text-[length:var(--text-meta)] ${
              view === 'week' ? 'bg-surface text-fg shadow-[var(--shadow-xs)]' : 'text-muted'
            }`}
            onClick={() => moveView('week')}
          >
            {t.schedule.week}
          </button>
          <button
            type="button"
            aria-pressed={view === 'month'}
            className={`h-7 rounded-sm px-3 text-[length:var(--text-meta)] ${
              view === 'month' ? 'bg-surface text-fg shadow-[var(--shadow-xs)]' : 'text-muted'
            }`}
            onClick={() => moveView('month')}
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
      {placement.view === 'month' ? (
        <MonthGrid
          model={placement}
          today={today}
          weekStartsOn={weekStartsOn}
          timeZone={timeZone}
          draft={draft}
          onDraft={onDraft}
          onEdit={onEdit}
          onOpen={openTask}
          onOpenDay={openDay}
        />
      ) : (
        <WeekGrid
          model={placement}
          today={today}
          timeZone={timeZone}
          draft={draft}
          onDraft={onDraft}
          onEdit={onEdit}
          onOpen={openTask}
          onOpenDay={openDay}
        />
      )}
      {todos.detailOpen && todos.selectedId !== null ? (
        <ScheduleDetail taskId={todos.selectedId} timeZone={timeZone} />
      ) : null}
    </div>
  );
});
