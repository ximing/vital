import type { ScheduleDraft } from '@/features/todos';
import { addDaysYmd, zonedLocalMidnightIso, zonedWallTimeIso } from '@/features/todos/model';

/** Drag-to-create snaps to a quarter hour, the same increment as Google Calendar. */
export const SLOT_MINUTES = 15;

export const QUARTER_MINUTES = [0, 15, 30, 45] as const;
export type SlotMinute = (typeof QUARTER_MINUTES)[number];

export function isSlotMinute(value: number): value is SlotMinute {
  return value === 0 || value === 15 || value === 30 || value === 45;
}

/** One empty quarter-hour cell. `hour` is 0–23 and `minute` is 0, 15, 30, or 45. */
export type HourCell = { kind: 'hour'; ymd: string; hour: number; minute: SlotMinute };

/** One all-day or month cell. The date is that cell's own local date. */
export type DayCell = { kind: 'day'; ymd: string };

/** Pointer went down on an existing occurrence, which is not a create target. */
export type ItemHit = { kind: 'item' };

export type GesturePoint = HourCell | DayCell | ItemHit;

export type TimedCreateRange = {
  kind: 'timed';
  /** Column the pointer went down on. A sideways slide does not change it. */
  ymd: string;
  /** Inclusive first and last quarter-hour slots. */
  startHour: number;
  startMinute: SlotMinute;
  endHour: number;
  endMinute: SlotMinute;
  startAt: string;
  dueAt: string;
  isAllDay: false;
};

export type AllDayCreateRange = {
  kind: 'allDay';
  /** Inclusive local dates. */
  startYmd: string;
  endYmd: string;
  startAt: string;
  dueAt: string;
  isAllDay: true;
};

export type ScheduleCreateRange = TimedCreateRange | AllDayCreateRange;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MINUTES = 24 * 60;

function minutesOf(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function clock(totalMinutes: number): string {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function hmText(totalMinutes: number): string {
  return clock(totalMinutes).slice(0, 5);
}

function timedRange(
  ymd: string,
  fromHour: number,
  fromMinute: number,
  toHour: number,
  toMinute: number,
  timeZone: string,
): TimedCreateRange | null {
  if (!YMD.test(ymd)) return null;
  if (!Number.isInteger(fromHour) || fromHour < 0 || fromHour > 23) return null;
  if (!Number.isInteger(toHour) || toHour < 0 || toHour > 23) return null;
  if (!isSlotMinute(fromMinute) || !isSlotMinute(toMinute)) return null;
  const from = minutesOf(fromHour, fromMinute);
  const to = minutesOf(toHour, toMinute);
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const endExclusive = end + SLOT_MINUTES;
  // The selection runs through the end of the later slot. 23:45 ends at the
  // next local midnight, and the task stays timed.
  const dueAt =
    endExclusive >= DAY_MINUTES
      ? zonedLocalMidnightIso(addDaysYmd(ymd, 1), timeZone)
      : zonedWallTimeIso(ymd, clock(endExclusive), timeZone);
  return {
    kind: 'timed',
    ymd,
    startHour: Math.floor(start / 60),
    startMinute: (start % 60) as SlotMinute,
    endHour: Math.floor(end / 60),
    endMinute: (end % 60) as SlotMinute,
    startAt: zonedWallTimeIso(ymd, clock(start), timeZone),
    dueAt,
    isAllDay: false,
  };
}

function allDayRange(fromYmd: string, toYmd: string, timeZone: string): AllDayCreateRange | null {
  if (!YMD.test(fromYmd) || !YMD.test(toYmd)) return null;
  const startYmd = fromYmd < toYmd ? fromYmd : toYmd;
  const endYmd = fromYmd < toYmd ? toYmd : fromYmd;
  // Both instants are local midnights, so the closed date interval is exactly
  // the days the pointer covered. dueAt is the last selected day, not the next one.
  return {
    kind: 'allDay',
    startYmd,
    endYmd,
    startAt: zonedLocalMidnightIso(startYmd, timeZone),
    dueAt: zonedLocalMidnightIso(endYmd, timeZone),
    isAllDay: true,
  };
}

/**
 * Local interval for a press and release on the schedule grid.
 * Dates and slots come from the cells' data, not from layout measurements.
 * Returns null when the press started on an existing occurrence.
 */
export function scheduleGestureRange(
  down: GesturePoint,
  up: GesturePoint,
  timeZone: string,
): ScheduleCreateRange | null {
  if (down.kind === 'item') return null;
  if (down.kind === 'hour') {
    const hour = up.kind === 'hour' ? up.hour : down.hour;
    const minute = up.kind === 'hour' ? up.minute : down.minute;
    return timedRange(down.ymd, down.hour, down.minute, hour, minute, timeZone);
  }
  const ymd = up.kind === 'day' ? up.ymd : down.ymd;
  return allDayRange(down.ymd, ymd, timeZone);
}

/** True when this cell should show the draft or drag selection. */
export function scheduleRangeHitsCell(range: ScheduleCreateRange, cell: HourCell | DayCell): boolean {
  if (range.kind === 'timed') {
    if (cell.kind !== 'hour' || cell.ymd !== range.ymd) return false;
    const at = minutesOf(cell.hour, cell.minute);
    const start = minutesOf(range.startHour, range.startMinute);
    const end = minutesOf(range.endHour, range.endMinute);
    return at >= start && at <= end;
  }
  return cell.kind === 'day' && cell.ymd >= range.startYmd && cell.ymd <= range.endYmd;
}

function dayText(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
}

/** Chinese label of the selected interval, shown above the quick-create field. */
export function scheduleRangeLabel(range: ScheduleCreateRange): string {
  if (range.kind === 'allDay') {
    const start = dayText(range.startYmd);
    if (range.startYmd === range.endYmd) return start;
    return `${start} – ${dayText(range.endYmd)}`;
  }
  const start = hmText(minutesOf(range.startHour, range.startMinute));
  const endTotal = minutesOf(range.endHour, range.endMinute) + SLOT_MINUTES;
  const day = dayText(range.ymd);
  if (endTotal >= DAY_MINUTES) {
    return `${day} ${start} – ${dayText(addDaysYmd(range.ymd, 1))} 00:00`;
  }
  return `${day} ${start} – ${hmText(endTotal)}`;
}

function blankDraft(): ScheduleDraft {
  return {
    mode: 'point',
    startYmd: null,
    endYmd: null,
    startHm: null,
    endHm: null,
    reminder: 'none',
    reminderAt: null,
    recurrenceKind: null,
    recurrence: null,
  };
}

/** Schedule draft the global quick-create overlay pins to this gesture. */
export function scheduleDraftFromRange(range: ScheduleCreateRange): ScheduleDraft {
  const draft = blankDraft();
  if (range.kind === 'allDay') {
    return {
      ...draft,
      mode: 'range',
      startYmd: range.startYmd,
      endYmd: range.endYmd,
    };
  }
  const endTotal = minutesOf(range.endHour, range.endMinute) + SLOT_MINUTES;
  const nextDay = endTotal >= DAY_MINUTES;
  return {
    ...draft,
    mode: 'range',
    startYmd: range.ymd,
    endYmd: nextDay ? addDaysYmd(range.ymd, 1) : range.ymd,
    startHm: hmText(minutesOf(range.startHour, range.startMinute)),
    endHm: nextDay ? '00:00' : hmText(endTotal),
  };
}
