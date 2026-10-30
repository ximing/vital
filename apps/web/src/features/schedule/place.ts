import { addMonthsYmd } from '@/lib/calendar-grid';
import {
  addDaysYmd,
  formatHm,
  formatYmd,
  startOfWeekYmd,
  weekdayInZone,
  weekRangeIso,
  weekYmids,
  zonedLocalMidnightIso,
} from '@/features/todos/model';

/** One expanded calendar occurrence. Unscheduled tasks never arrive here. */
export type ScheduleOccurrence = {
  taskId: string;
  title: string;
  occurrenceAt: string;
  isAllDay: boolean;
};

export type ScheduleView = 'week' | 'month';

export type ScheduleChip = {
  key: string;
  taskId: string;
  title: string;
  /** Local clock `HH:mm`. Null for an all-day occurrence. */
  timeLabel: string | null;
};

export type WeekHour = {
  hour: number;
  items: ScheduleChip[];
};

export type WeekDay = {
  ymd: string;
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  allDay: ScheduleChip[];
  /** Index is the local hour, 0 through 23. Always present, even when empty. */
  hours: WeekHour[];
};

export type WeekPlacement = {
  view: 'week';
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
  if (view === 'week') return addDaysYmd(cursorYmd, dir * 7);
  return addMonthsYmd(cursorYmd, dir);
}

function chipKey(item: ScheduleOccurrence): string {
  return `${item.taskId}:${item.occurrenceAt}:${item.isAllDay ? 'day' : 'time'}`;
}

function localOf(
  occurrenceAt: string,
  timeZone: string,
): { ymd: string; hour: number; timeLabel: string } | null {
  const instant = new Date(occurrenceAt);
  if (Number.isNaN(instant.getTime())) return null;
  const timeLabel = formatHm(occurrenceAt, timeZone);
  const hour = Number(timeLabel.slice(0, 2));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { ymd: formatYmd(instant, timeZone), hour, timeLabel };
}

function emptyHours(): WeekHour[] {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, items: [] }));
}

function placeWeek(input: PlaceScheduleInput): WeekPlacement {
  const days = weekYmids(input.cursorYmd, input.weekStartsOn, input.timeZone);
  const columns = new Map<string, WeekDay>();
  for (const ymd of days) {
    columns.set(ymd, {
      ymd,
      weekday: weekdayInZone(ymd, input.timeZone) as WeekDay['weekday'],
      allDay: [],
      hours: emptyHours(),
    });
  }
  const ordered = [...input.occurrences].sort((a, b) => {
    const byTime = a.occurrenceAt.localeCompare(b.occurrenceAt);
    return byTime === 0 ? a.title.localeCompare(b.title) : byTime;
  });
  for (const item of ordered) {
    const local = localOf(item.occurrenceAt, input.timeZone);
    if (local === null) continue;
    const column = columns.get(local.ymd);
    if (column === undefined) continue;
    const chip: ScheduleChip = {
      key: chipKey(item),
      taskId: item.taskId,
      title: item.title,
      timeLabel: item.isAllDay ? null : local.timeLabel,
    };
    // All-day stays above the hours. A timed midnight stays in hour 0.
    if (item.isAllDay) column.allDay.push(chip);
    else column.hours[local.hour]?.items.push(chip);
  }
  const placed = days.flatMap((ymd) => {
    const column = columns.get(ymd);
    return column === undefined ? [] : [column];
  });
  return {
    view: 'week',
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
  const ordered = [...input.occurrences].sort((a, b) => {
    const byTime = a.occurrenceAt.localeCompare(b.occurrenceAt);
    return byTime === 0 ? a.title.localeCompare(b.title) : byTime;
  });
  for (const item of ordered) {
    const local = localOf(item.occurrenceAt, input.timeZone);
    if (local === null) continue;
    const cell = cells.get(local.ymd);
    if (cell === undefined) continue;
    cell.chips.push({
      key: chipKey(item),
      taskId: item.taskId,
      title: item.title,
      timeLabel: item.isAllDay ? null : local.timeLabel,
    });
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
 * Places expanded occurrences onto a week time grid or a month day grid.
 * Dates and hours are the user timezone's wall clock, not a UTC date slice.
 */
export function placeSchedule(input: PlaceScheduleInput): SchedulePlacement {
  return input.view === 'week' ? placeWeek(input) : placeMonth(input);
}
