import {
  addDaysYmd,
  addMonthsYmd,
  formatHm,
  formatYmd,
  startOfWeekYmd,
  weekdayInZone,
  weekRangeIso,
  weekYmids,
  zonedLocalMidnightIso,
} from './time';

/** One expanded calendar occurrence. Unscheduled tasks never arrive here. */
export type ScheduleOccurrence = {
  taskId: string;
  title: string;
  occurrenceAt: string;
  /** Later end of a timed block. Null for a point or an all-day occurrence. */
  endsAt?: string | null;
  isAllDay: boolean;
  /** Habit instances sort after other tasks in the month grid. */
  habit?: boolean;
  /** Device-calendar mirror. The grid does not move or resize it. */
  locked?: boolean;
};

export type ScheduleView = 'day' | 'week' | 'month';

export type ScheduleChip = {
  key: string;
  taskId: string;
  title: string;
  /** Local clock `HH:mm`. Null for an all-day occurrence. */
  timeLabel: string | null;
  /** Occurrence start. For an all-day chip this is one end's midnight. */
  startAt?: string;
  /** Timed end, or the same instant as `startAt` for a point. */
  dueAt?: string;
  isAllDay?: boolean;
  /** Inclusive local dates of an all-day span. Timed chips repeat their day. */
  spanStartYmd?: string;
  spanEndYmd?: string;
  locked?: boolean;
};

export type WeekHour = {
  hour: number;
  items: ScheduleChip[];
};

/** A timed block drawn across quarter-hours. `endMinute` is exclusive and at most 1440. */
export type WeekBlock = {
  key: string;
  taskId: string;
  title: string;
  startMinute: number;
  endMinute: number;
  timeLabel: string;
  lane: number;
  laneCount: number;
  startAt: string;
  dueAt: string;
  /** Top edge belongs to this slice, so dragging it changes `startAt`. */
  resizeStart: boolean;
  /** Bottom edge belongs to this slice, so dragging it changes `dueAt`. */
  resizeEnd: boolean;
  locked: boolean;
};

export type WeekDay = {
  ymd: string;
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  allDay: ScheduleChip[];
  /** Index is the local hour, 0 through 23. Always present, even when empty. */
  hours: WeekHour[];
  blocks: WeekBlock[];
};

/** Month cells show this many chips, then a 查看更多 row for the rest. */
export const MONTH_CELL_LIMIT = 3;

export function monthCellPreview(chips: readonly ScheduleChip[]): {
  shown: ScheduleChip[];
  hidden: ScheduleChip[];
} {
  if (chips.length <= MONTH_CELL_LIMIT) return { shown: [...chips], hidden: [] };
  const shown = chips.slice(0, MONTH_CELL_LIMIT - 1);
  return { shown, hidden: chips.slice(shown.length) };
}

const DAY_MINUTES = 24 * 60;

/** Hour row aligned to the top of the week scroller: the current local hour. */
export function scheduleScrollHour(timeZone: string, now = new Date()): number {
  const label = formatHm(now.toISOString(), timeZone);
  const hour = Number(label.slice(0, 2));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return 8;
  return hour;
}

/** Minute from local midnight for the current-time line. */
export function scheduleNowMinute(timeZone: string, now = new Date()): number {
  const label = formatHm(now.toISOString(), timeZone);
  const hour = Number(label.slice(0, 2));
  const minute = Number(label.slice(3, 5));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return 8 * 60;
  return hour * 60 + minute;
}

export type WeekPlacement = {
  view: 'week' | 'day';
  startYmd: string;
  endYmd: string;
  days: WeekDay[];
};

export type MonthCell = {
  ymd: string;
  inMonth: boolean;
  chips: ScheduleChip[];
};

export type MonthPlacement = {
  view: 'month';
  year: number;
  month: number;
  cells: MonthCell[];
};

export type SchedulePlacement = WeekPlacement | MonthPlacement;

export type PlaceScheduleInput = {
  occurrences: readonly ScheduleOccurrence[];
  timeZone: string;
  weekStartsOn: 0 | 1;
  cursorYmd: string;
  view: ScheduleView;
};

const MONTH_CELLS = 42;

function monthFirst(cursorYmd: string): string {
  return `${cursorYmd.slice(0, 7)}-01`;
}

function monthYmds(cursorYmd: string, weekStartsOn: 0 | 1, timeZone: string): string[] {
  const start = startOfWeekYmd(monthFirst(cursorYmd), weekStartsOn, timeZone);
  return Array.from({ length: MONTH_CELLS }, (_, index) => addDaysYmd(start, index));
}

function rangeIso(
  startYmd: string,
  endYmd: string,
  timeZone: string,
): { from: string; to: string } {
  const endExclusive = addDaysYmd(endYmd, 1);
  const from = zonedLocalMidnightIso(startYmd, timeZone);
  const to = new Date(
    new Date(zonedLocalMidnightIso(endExclusive, timeZone)).getTime() - 1,
  ).toISOString();
  return { from, to };
}

/** Inclusive window the page asks the calendar API for. Matches the grid the placement draws. */
export function scheduleRangeIso(
  cursorYmd: string,
  view: ScheduleView,
  weekStartsOn: 0 | 1,
  timeZone: string,
): { from: string; to: string } {
  if (view === 'day') return rangeIso(cursorYmd, cursorYmd, timeZone);
  if (view === 'week') {
    const range = weekRangeIso(cursorYmd, weekStartsOn, timeZone);
    return { from: range.from, to: range.to };
  }
  const ymds = monthYmds(cursorYmd, weekStartsOn, timeZone);
  const start = ymds[0] ?? monthFirst(cursorYmd);
  const end = ymds[ymds.length - 1] ?? start;
  return rangeIso(start, end, timeZone);
}

export function shiftScheduleCursor(cursorYmd: string, view: ScheduleView, dir: -1 | 1): string {
  if (view === 'day') return addDaysYmd(cursorYmd, dir);
  if (view === 'week') return addDaysYmd(cursorYmd, dir * 7);
  return addMonthsYmd(cursorYmd, dir);
}

function chipKey(item: ScheduleOccurrence): string {
  return `${item.taskId}:${item.occurrenceAt}:${item.isAllDay ? 'day' : 'time'}`;
}

function localClock(
  iso: string,
  timeZone: string,
): { ymd: string; minute: number; timeLabel: string } | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const timeLabel = formatHm(iso, timeZone);
  const hour = Number(timeLabel.slice(0, 2));
  const minute = Number(timeLabel.slice(3, 5));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { ymd: formatYmd(instant, timeZone), minute: hour * 60 + minute, timeLabel };
}

function hm(minute: number): string {
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  return `${String(hour).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function rangeLabel(startMinute: number, endMinute: number): string {
  const end = endMinute >= DAY_MINUTES ? '24:00' : hm(endMinute);
  return `${hm(startMinute)}\u2013${end}`;
}

type DaySlice = { ymd: string; startMinute: number; endMinute: number };

/** Wall-clock slices. A point has `endMinute === startMinute`. A block ends at midnight as 1440. */
function slicesOf(item: ScheduleOccurrence, timeZone: string): DaySlice[] | null {
  const start = localClock(item.occurrenceAt, timeZone);
  if (start === null) return null;
  const endIso = item.endsAt;
  if (item.isAllDay || endIso == null || endIso === '') {
    return [{ ymd: start.ymd, startMinute: start.minute, endMinute: start.minute }];
  }
  const end = localClock(endIso, timeZone);
  if (end === null || end.ymd < start.ymd || (end.ymd === start.ymd && end.minute <= start.minute)) {
    return [{ ymd: start.ymd, startMinute: start.minute, endMinute: start.minute }];
  }
  const slices: DaySlice[] = [];
  let ymd = start.ymd;
  for (let guard = 0; ymd <= end.ymd && guard < 70; guard += 1) {
    const dayStart = ymd === start.ymd ? start.minute : 0;
    const dayEnd = ymd === end.ymd ? end.minute : DAY_MINUTES;
    if (dayEnd > dayStart) slices.push({ ymd, startMinute: dayStart, endMinute: dayEnd });
    if (ymd === end.ymd) break;
    ymd = addDaysYmd(ymd, 1);
  }
  return slices;
}

type ItemClock = {
  startAt: string;
  dueAt: string;
  isAllDay: boolean;
  spanStartYmd: string;
  spanEndYmd: string;
  locked: boolean;
};

function allDaySpans(
  items: readonly ScheduleOccurrence[],
  timeZone: string,
): Map<string, { startYmd: string; endYmd: string }> {
  const spans = new Map<string, { startYmd: string; endYmd: string }>();
  for (const item of items) {
    if (!item.isAllDay) continue;
    const local = localClock(item.occurrenceAt, timeZone);
    if (local === null) continue;
    const current = spans.get(item.taskId);
    if (current === undefined) {
      spans.set(item.taskId, { startYmd: local.ymd, endYmd: local.ymd });
      continue;
    }
    if (local.ymd < current.startYmd) current.startYmd = local.ymd;
    if (local.ymd > current.endYmd) current.endYmd = local.ymd;
  }
  return spans;
}

function clockOf(
  item: ScheduleOccurrence,
  spans: Map<string, { startYmd: string; endYmd: string }>,
  timeZone: string,
): ItemClock | null {
  const start = localClock(item.occurrenceAt, timeZone);
  if (start === null) return null;
  const locked = item.locked === true;
  if (item.isAllDay) {
    const span = spans.get(item.taskId) ?? { startYmd: start.ymd, endYmd: start.ymd };
    return {
      startAt: item.occurrenceAt,
      dueAt: item.occurrenceAt,
      isAllDay: true,
      spanStartYmd: span.startYmd,
      spanEndYmd: span.endYmd,
      locked,
    };
  }
  const endIso = item.endsAt;
  const end = endIso == null || endIso === '' ? null : localClock(endIso, timeZone);
  const point =
    end === null || end.ymd < start.ymd || (end.ymd === start.ymd && end.minute <= start.minute);
  return {
    startAt: item.occurrenceAt,
    dueAt: point || endIso == null ? item.occurrenceAt : endIso,
    isAllDay: false,
    spanStartYmd: start.ymd,
    spanEndYmd: point || end === null ? start.ymd : end.ymd,
    locked,
  };
}

function chipOf(
  item: ScheduleOccurrence,
  timeLabel: string | null,
  ymd: string,
  clock: ItemClock,
): ScheduleChip {
  return {
    key: `${chipKey(item)}:${ymd}`,
    taskId: item.taskId,
    title: item.title,
    timeLabel,
    startAt: clock.startAt,
    dueAt: clock.dueAt,
    isAllDay: clock.isAllDay,
    spanStartYmd: clock.spanStartYmd,
    spanEndYmd: clock.spanEndYmd,
    locked: clock.locked,
  };
}

function ownsEnd(slice: DaySlice, end: { ymd: string; minute: number }): boolean {
  if (slice.ymd === end.ymd && slice.endMinute === end.minute) return true;
  return slice.endMinute === DAY_MINUTES && end.minute === 0 && addDaysYmd(slice.ymd, 1) === end.ymd;
}

type Unlaned = Omit<WeekBlock, 'lane' | 'laneCount'>;

function assignLanes(blocks: Unlaned[]): WeekBlock[] {
  const sorted = [...blocks].sort(
    (a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute || a.title.localeCompare(b.title, 'zh'),
  );
  const laneEnds: number[] = [];
  const assigned: { block: Unlaned; lane: number }[] = [];
  for (const block of sorted) {
    let lane = laneEnds.findIndex((end) => end <= block.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.endMinute);
    } else {
      laneEnds[lane] = block.endMinute;
    }
    assigned.push({ block, lane });
  }
  return assigned.map(({ block, lane }) => {
    const lanes = new Set<number>();
    for (const other of assigned) {
      const overlaps =
        block.startMinute < other.block.endMinute && other.block.startMinute < block.endMinute;
      if (overlaps) lanes.add(other.lane);
    }
    return { ...block, lane, laneCount: Math.max(1, lanes.size) };
  });
}

function emptyHours(): WeekHour[] {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, items: [] }));
}

function placeColumns(
  days: readonly string[],
  view: 'week' | 'day',
  input: PlaceScheduleInput,
): WeekPlacement {
  const columns = new Map<string, WeekDay>();
  for (const ymd of days) {
    columns.set(ymd, {
      ymd,
      weekday: weekdayInZone(ymd, input.timeZone) as WeekDay['weekday'],
      allDay: [],
      hours: emptyHours(),
      blocks: [],
    });
  }
  const spans = allDaySpans(input.occurrences, input.timeZone);
  const pending = new Map<string, Unlaned[]>();
  const ordered = [...input.occurrences].sort((a, b) => {
    const byTime = a.occurrenceAt.localeCompare(b.occurrenceAt);
    return byTime === 0 ? a.title.localeCompare(b.title, 'zh') : byTime;
  });
  for (const item of ordered) {
    const slices = slicesOf(item, input.timeZone);
    const clock = clockOf(item, spans, input.timeZone);
    if (slices === null || clock === null) continue;
    if (item.isAllDay) {
      const slice = slices[0];
      const column = slice === undefined ? undefined : columns.get(slice.ymd);
      if (column === undefined || slice === undefined) continue;
      column.allDay.push(chipOf(item, null, slice.ymd, clock));
      continue;
    }
    const start = localClock(item.occurrenceAt, input.timeZone);
    const endIso = item.endsAt;
    const end = endIso == null || endIso === '' ? null : localClock(endIso, input.timeZone);
    for (const slice of slices) {
      const column = columns.get(slice.ymd);
      if (column === undefined) continue;
      if (slice.endMinute <= slice.startMinute) {
        const hour = Math.floor(slice.startMinute / 60);
        column.hours[hour]?.items.push(chipOf(item, hm(slice.startMinute), slice.ymd, clock));
        continue;
      }
      const list = pending.get(slice.ymd) ?? [];
      list.push({
        key: `${chipKey(item)}:${slice.ymd}`,
        taskId: item.taskId,
        title: item.title,
        startMinute: slice.startMinute,
        endMinute: slice.endMinute,
        timeLabel: rangeLabel(slice.startMinute, slice.endMinute),
        startAt: clock.startAt,
        dueAt: clock.dueAt,
        resizeStart:
          start !== null && slice.ymd === start.ymd && slice.startMinute === start.minute,
        resizeEnd: end !== null && ownsEnd(slice, end),
        locked: clock.locked,
      });
      pending.set(slice.ymd, list);
    }
  }
  for (const [ymd, column] of columns) {
    column.blocks = assignLanes(pending.get(ymd) ?? []);
  }
  const placed = days.flatMap((ymd) => {
    const column = columns.get(ymd);
    return column === undefined ? [] : [column];
  });
  return {
    view,
    startYmd: placed[0]?.ymd ?? input.cursorYmd,
    endYmd: placed[placed.length - 1]?.ymd ?? input.cursorYmd,
    days: placed,
  };
}

function placeMonth(input: PlaceScheduleInput): MonthPlacement {
  const first = monthFirst(input.cursorYmd);
  const year = Number(first.slice(0, 4));
  const month = Number(first.slice(5, 7));
  const last = addDaysYmd(addMonthsYmd(first, 1), -1);
  const ymds = monthYmds(input.cursorYmd, input.weekStartsOn, input.timeZone);
  const cells = new Map<string, MonthCell>();
  for (const ymd of ymds) {
    cells.set(ymd, { ymd, inMonth: ymd >= first && ymd <= last, chips: [] });
  }
  const spans = allDaySpans(input.occurrences, input.timeZone);
  const ordered = [...input.occurrences].sort((a, b) => {
    const habit = Number(Boolean(a.habit)) - Number(Boolean(b.habit));
    if (habit !== 0) return habit;
    const allDay = Number(!a.isAllDay) - Number(!b.isAllDay);
    if (allDay !== 0) return allDay;
    const byTime = a.occurrenceAt.localeCompare(b.occurrenceAt);
    return byTime === 0 ? a.title.localeCompare(b.title, 'zh') : byTime;
  });
  for (const item of ordered) {
    const slices = slicesOf(item, input.timeZone);
    const clock = clockOf(item, spans, input.timeZone);
    if (slices === null || clock === null) continue;
    for (const slice of slices) {
      const cell = cells.get(slice.ymd);
      if (cell === undefined) continue;
      cell.chips.push(
        chipOf(item, item.isAllDay ? null : hm(slice.startMinute), slice.ymd, clock),
      );
    }
  }
  return {
    view: 'month',
    year,
    month,
    cells: ymds.flatMap((ymd) => {
      const cell = cells.get(ymd);
      return cell === undefined ? [] : [cell];
    }),
  };
}

/**
 * Places expanded occurrences onto a day or week time grid, or a month day grid.
 * Dates and hours are the user timezone's wall clock, not a UTC date slice.
 */
export function placeSchedule(input: PlaceScheduleInput): SchedulePlacement {
  if (input.view === 'month') return placeMonth(input);
  if (input.view === 'day') return placeColumns([input.cursorYmd], 'day', input);
  const days = weekYmids(input.cursorYmd, input.weekStartsOn, input.timeZone);
  return placeColumns(days, 'week', input);
}
