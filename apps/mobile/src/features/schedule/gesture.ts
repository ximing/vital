import {
  addDaysYmd,
  formatHm,
  formatYmd,
  zonedLocalMidnightIso,
  zonedWallTimeIso,
} from './time';

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

/** Clock change written with patchTask. `dueAt` equals `startAt` for a point. */
export type ScheduleTimeChange = {
  startAt: string;
  dueAt: string;
  isAllDay: boolean;
};

function dayIndex(ymd: string): number {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function dayDelta(fromYmd: string, toYmd: string): number {
  return dayIndex(toYmd) - dayIndex(fromYmd);
}

function sameInstant(left: string, right: string): boolean {
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && a === b;
}

function shiftInstant(iso: string, deltaMs: number): string | null {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return null;
  return new Date(at + deltaMs).toISOString();
}

/**
 * Move a timed occurrence by the quarter-hour cells the pointer crossed.
 * The grab offset stays, so a 14:07 start dropped one hour later lands at 15:07.
 * The day can change. A zero move returns null.
 */
export function shiftTimedOccurrence(input: {
  startAt: string;
  dueAt: string;
  origin: HourCell;
  target: HourCell;
}): ScheduleTimeChange | null {
  const deltaMinutes =
    dayDelta(input.origin.ymd, input.target.ymd) * DAY_MINUTES +
    (minutesOf(input.target.hour, input.target.minute) -
      minutesOf(input.origin.hour, input.origin.minute));
  if (deltaMinutes === 0) return null;
  const deltaMs = deltaMinutes * 60_000;
  const startAt = shiftInstant(input.startAt, deltaMs);
  const dueAt = shiftInstant(input.dueAt, deltaMs);
  if (startAt === null || dueAt === null) return null;
  return { startAt, dueAt, isAllDay: false };
}

/**
 * Move a timed occurrence that lives in a day cell (month view) by whole days.
 * The clock time stays. A zero move returns null.
 */
export function shiftTimedByDays(input: {
  startAt: string;
  dueAt: string;
  originYmd: string;
  targetYmd: string;
}): ScheduleTimeChange | null {
  const days = dayDelta(input.originYmd, input.targetYmd);
  if (days === 0) return null;
  const deltaMs = days * DAY_MINUTES * 60_000;
  const startAt = shiftInstant(input.startAt, deltaMs);
  const dueAt = shiftInstant(input.dueAt, deltaMs);
  if (startAt === null || dueAt === null) return null;
  return { startAt, dueAt, isAllDay: false };
}

/**
 * Move an all-day span by whole days. `startYmd` and `endYmd` are the inclusive
 * local dates. Both midnights move by the same amount.
 */
export function shiftAllDayOccurrence(input: {
  startYmd: string;
  endYmd: string;
  originYmd: string;
  targetYmd: string;
  timeZone: string;
}): ScheduleTimeChange | null {
  const days = dayDelta(input.originYmd, input.targetYmd);
  if (days === 0) return null;
  if (!YMD.test(input.startYmd) || !YMD.test(input.endYmd)) return null;
  const startYmd = addDaysYmd(input.startYmd, days);
  const endYmd = addDaysYmd(input.endYmd, days);
  return {
    startAt: zonedLocalMidnightIso(startYmd, input.timeZone),
    dueAt: zonedLocalMidnightIso(endYmd, input.timeZone),
    isAllDay: true,
  };
}

type LocalMinute = { ymd: string; minute: number };

function localMinute(iso: string, timeZone: string): LocalMinute | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const label = formatHm(iso, timeZone);
  const hour = Number(label.slice(0, 2));
  const minute = Number(label.slice(3, 5));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { ymd: formatYmd(instant, timeZone), minute: hour * 60 + minute };
}

/**
 * Drag the top or bottom edge of a timed block. The edge stays on `ymd`.
 * The bottom sets the exclusive end to the target quarter plus 15 minutes
 * (23:45 ends at the next local midnight). The top sets the start to that
 * quarter. The shorter end is 15 minutes.
 */
export function resizeTimedOccurrence(input: {
  ymd: string;
  startAt: string;
  dueAt: string;
  edge: 'start' | 'end';
  hour: number;
  minute: SlotMinute;
  timeZone: string;
}): ScheduleTimeChange | null {
  if (!YMD.test(input.ymd)) return null;
  const start = localMinute(input.startAt, input.timeZone);
  const end = localMinute(input.dueAt, input.timeZone);
  if (start === null || end === null) return null;
  if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) return null;
  if (!isSlotMinute(input.minute)) return null;
  const endAbs = dayIndex(end.ymd) * DAY_MINUTES + end.minute;
  const startAbs = dayIndex(start.ymd) * DAY_MINUTES + start.minute;

  if (input.edge === 'end') {
    let endExclusive = minutesOf(input.hour, input.minute) + SLOT_MINUTES;
    if (endExclusive > DAY_MINUTES) endExclusive = DAY_MINUTES;
    if (dayIndex(input.ymd) * DAY_MINUTES + endExclusive < startAbs + SLOT_MINUTES) {
      const minEnd =
        start.ymd === input.ymd
          ? Math.ceil((start.minute + SLOT_MINUTES) / SLOT_MINUTES) * SLOT_MINUTES
          : SLOT_MINUTES;
      if (minEnd > DAY_MINUTES) return null;
      endExclusive = minEnd;
    }
    const dueAt =
      endExclusive >= DAY_MINUTES
        ? zonedLocalMidnightIso(addDaysYmd(input.ymd, 1), input.timeZone)
        : zonedWallTimeIso(input.ymd, clock(endExclusive), input.timeZone);
    if (sameInstant(dueAt, input.dueAt)) return null;
    return { startAt: input.startAt, dueAt, isAllDay: false };
  }

  let startMinute = minutesOf(input.hour, input.minute);
  const maxAbs = endAbs - SLOT_MINUTES;
  const dayStart = dayIndex(input.ymd) * DAY_MINUTES;
  if (dayStart + startMinute > maxAbs) {
    if (maxAbs < dayStart) return null;
    startMinute = Math.floor((maxAbs - dayStart) / SLOT_MINUTES) * SLOT_MINUTES;
    if (startMinute < 0 || dayStart + startMinute + SLOT_MINUTES > endAbs) return null;
  }
  const startAt = zonedWallTimeIso(input.ymd, clock(startMinute), input.timeZone);
  if (sameInstant(startAt, input.startAt)) return null;
  return { startAt, dueAt: input.dueAt, isAllDay: false };
}

function quartersCovered(startMinute: number, endMinute: number): { start: number; end: number } | null {
  if (endMinute <= startMinute) {
    const slot = Math.floor(startMinute / SLOT_MINUTES) * SLOT_MINUTES;
    if (slot < 0 || slot >= DAY_MINUTES) return null;
    return { start: slot, end: slot };
  }
  const start = Math.floor(startMinute / SLOT_MINUTES) * SLOT_MINUTES;
  const last = endMinute % SLOT_MINUTES === 0 ? endMinute - SLOT_MINUTES : Math.floor(endMinute / SLOT_MINUTES) * SLOT_MINUTES;
  if (last < start) return { start, end: start };
  return { start, end: Math.min(last, DAY_MINUTES - SLOT_MINUTES) };
}

function rangeFromQuarters(
  ymd: string,
  startMinute: number,
  endMinute: number,
  timeZone: string,
): TimedCreateRange | null {
  if (!isSlotMinute(startMinute % 60) || !isSlotMinute(endMinute % 60)) return null;
  return timedRange(
    ymd,
    Math.floor(startMinute / 60),
    (startMinute % 60) as SlotMinute,
    Math.floor(endMinute / 60),
    (endMinute % 60) as SlotMinute,
    timeZone,
  );
}

/** Quarter cells a moved or resized interval should highlight. */
export function scheduleChangeHighlight(
  change: ScheduleTimeChange,
  timeZone: string,
): ScheduleCreateRange[] {
  if (change.isAllDay) {
    const start = localMinute(change.startAt, timeZone);
    const end = localMinute(change.dueAt, timeZone);
    if (start === null || end === null) return [];
    const range = allDayRange(start.ymd, end.ymd, timeZone);
    return range === null ? [] : [range];
  }
  const start = localMinute(change.startAt, timeZone);
  const end = localMinute(change.dueAt, timeZone);
  if (start === null || end === null) return [];
  if (end.ymd < start.ymd || (end.ymd === start.ymd && end.minute <= start.minute)) {
    const slot = quartersCovered(start.minute, start.minute);
    if (slot === null) return [];
    const range = rangeFromQuarters(start.ymd, slot.start, slot.end, timeZone);
    return range === null ? [] : [range];
  }
  const ranges: ScheduleCreateRange[] = [];
  let ymd = start.ymd;
  for (let guard = 0; ymd <= end.ymd && guard < 70; guard += 1) {
    const dayStart = ymd === start.ymd ? start.minute : 0;
    const dayEnd = ymd === end.ymd ? end.minute : DAY_MINUTES;
    if (dayEnd > dayStart) {
      const slot = quartersCovered(dayStart, dayEnd);
      if (slot !== null) {
        const range = rangeFromQuarters(ymd, slot.start, slot.end, timeZone);
        if (range) ranges.push(range);
      }
    }
    if (ymd === end.ymd) break;
    ymd = addDaysYmd(ymd, 1);
  }
  return ranges;
}

/** Inclusive start and exclusive end, in minutes from local midnight, of a timed draft. */
export function timedDraftMinutes(draft: TimedCreateRange): { start: number; end: number } {
  const start = minutesOf(draft.startHour, draft.startMinute);
  let end = minutesOf(draft.endHour, draft.endMinute) + SLOT_MINUTES;
  if (end > DAY_MINUTES) end = DAY_MINUTES;
  return { start, end };
}

/**
 * Slide a not-yet-saved timed selection inside its day.
 * A sideways move does not change the day. A zero move returns null.
 */
export function shiftTimedDraft(
  draft: TimedCreateRange,
  origin: HourCell,
  target: HourCell,
  timeZone: string,
): TimedCreateRange | null {
  const delta = minutesOf(target.hour, target.minute) - minutesOf(origin.hour, origin.minute);
  if (delta === 0) return null;
  const current = timedDraftMinutes(draft);
  const span = current.end - current.start - SLOT_MINUTES;
  let nextStart = minutesOf(draft.startHour, draft.startMinute) + delta;
  const maxStart = DAY_MINUTES - SLOT_MINUTES - span;
  if (nextStart < 0) nextStart = 0;
  if (nextStart > maxStart) nextStart = Math.max(0, maxStart);
  if (!isSlotMinute(nextStart % 60) || nextStart % SLOT_MINUTES !== 0) return null;
  const nextEnd = nextStart + span;
  const next = timedRange(
    draft.ymd,
    Math.floor(nextStart / 60),
    (nextStart % 60) as SlotMinute,
    Math.floor(nextEnd / 60),
    (nextEnd % 60) as SlotMinute,
    timeZone,
  );
  if (next === null || (next.startAt === draft.startAt && next.dueAt === draft.dueAt)) return null;
  return next;
}

/** Move a chip that lives in a day cell (all-day band or month) onto another day. */
export function shiftChipByDay(input: {
  startAt: string;
  dueAt: string;
  isAllDay: boolean;
  spanStartYmd: string;
  spanEndYmd: string;
  originYmd: string;
  targetYmd: string;
  timeZone: string;
}): ScheduleTimeChange | null {
  if (input.isAllDay) {
    return shiftAllDayOccurrence({
      startYmd: input.spanStartYmd,
      endYmd: input.spanEndYmd,
      originYmd: input.originYmd,
      targetYmd: input.targetYmd,
      timeZone: input.timeZone,
    });
  }
  return shiftTimedByDays({
    startAt: input.startAt,
    dueAt: input.dueAt,
    originYmd: input.originYmd,
    targetYmd: input.targetYmd,
  });
}

/** Drag the top or bottom of a not-yet-saved timed selection. The day stays put. */
export function resizeTimedDraft(
  draft: TimedCreateRange,
  edge: 'start' | 'end',
  hour: number,
  minute: SlotMinute,
  timeZone: string,
): TimedCreateRange | null {
  const next =
    edge === 'end'
      ? timedRange(draft.ymd, draft.startHour, draft.startMinute, hour, minute, timeZone)
      : timedRange(draft.ymd, hour, minute, draft.endHour, draft.endMinute, timeZone);
  if (next === null || (next.startAt === draft.startAt && next.dueAt === draft.dueAt)) return null;
  return next;
}
