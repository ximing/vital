import { DateTime } from 'luxon';

/** Used when a task has no positive estimate. */
export const DEFAULT_SLOT_MINUTES = 30;

export const SCHEDULE_OFF_TEXT =
  '自动建议排程已关闭。要排程请到设置里打开「允许自动建议排程」。';

export interface ScheduleWindow {
  /** Minutes from local midnight. End is exclusive. */
  startMin: number;
  endMin: number;
}

export interface ScheduleCandidate {
  id: string;
  title: string;
  minutes: number;
  /** 0 is the highest priority. */
  priority: number;
}

export interface SchedulePlacement {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
}

export interface ScheduleUnplaced {
  id: string;
  title: string;
  reason: '放不下';
}

export interface ScheduleProposal {
  placed: SchedulePlacement[];
  unplaced: ScheduleUnplaced[];
}

export function slotMinutes(estimate: number | null | undefined): number {
  if (typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0) return Math.round(estimate);
  return DEFAULT_SLOT_MINUTES;
}

export function hhmmToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Morning is through 12:00, afternoon starts at 12:00, both clipped to the work window. */
export function clipWorkWindow(
  startMin: number,
  endMin: number,
  part: 'morning' | 'afternoon' | 'day',
): ScheduleWindow | null {
  let start = startMin;
  let end = endMin;
  if (part === 'morning') end = Math.min(end, 12 * 60);
  if (part === 'afternoon') start = Math.max(start, 12 * 60);
  if (!(end > start)) return null;
  return { startMin: start, endMin: end };
}

export function isScheduleRequest(text: string): boolean {
  const raw = text.trim();
  if (/塞进|排进|代排|时间盒/.test(raw)) return true;
  if (/安排/.test(raw) && /时间|上午|下午|空档|时段/.test(raw)) return true;
  if (/排(一下|程)/.test(raw) && /[周星期][一二三四五六日天1-7]|明天|后天|今天|上午|下午/.test(raw)) {
    return true;
  }
  return false;
}

export function schedulePart(text: string): 'morning' | 'afternoon' | 'day' {
  const morning = /上午|早上|早晨/.test(text);
  const afternoon = /下午|傍晚/.test(text);
  if (morning && !afternoon) return 'morning';
  if (afternoon && !morning) return 'afternoon';
  return 'day';
}

/**
 * Clock block on `dayYmd`. All-day rows and zero-length calendar points do not block.
 * A calendar mirror stores the end on `calendarEndAt` because startAt and dueAt are both the start.
 */
export function busyBlock(
  row: {
    isAllDay: boolean;
    startAt: Date | null;
    dueAt: Date | null;
    calendarEndAt: Date | null;
  },
  zone: string,
  dayYmd: string,
): ScheduleWindow | null {
  if (row.isAllDay) return null;
  const start = row.startAt ?? row.dueAt;
  if (!start) return null;
  const end =
    row.calendarEndAt && row.calendarEndAt.getTime() > start.getTime()
      ? row.calendarEndAt
      : row.dueAt && row.dueAt.getTime() > start.getTime()
        ? row.dueAt
        : null;
  if (!end) return null;
  return localBusy(start, end, zone, dayYmd);
}

function localBusy(start: Date, end: Date, zone: string, dayYmd: string): ScheduleWindow | null {
  const day = DateTime.fromISO(dayYmd, { zone }).startOf('day');
  if (!day.isValid) return null;
  const next = day.plus({ days: 1 });
  const from = DateTime.fromJSDate(start).setZone(zone);
  const to = DateTime.fromJSDate(end).setZone(zone);
  if (!from.isValid || !to.isValid) return null;
  const clippedStart = from < day ? day : from;
  const clippedEnd = to > next ? next : to;
  if (clippedEnd <= clippedStart || clippedStart >= next || clippedEnd <= day) return null;
  const startMin = Math.round(clippedStart.diff(day, 'minutes').minutes);
  const endMin = Math.round(clippedEnd.diff(day, 'minutes').minutes);
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

export function formatSlotRange(start: Date | null, end: Date | null, zone: string): string {
  if (!start || !end || end.getTime() <= start.getTime()) return '未排';
  const a = DateTime.fromJSDate(start).setZone(zone);
  const b = DateTime.fromJSDate(end).setZone(zone);
  if (!a.isValid || !b.isValid) return '未排';
  if (a.toISODate() === b.toISODate()) return `${a.toFormat('HH:mm')}–${b.toFormat('HH:mm')}`;
  return `${a.toFormat('MM-dd HH:mm')}–${b.toFormat('HH:mm')}`;
}

export function minutesOnDay(dayYmd: string, minutes: number, zone: string): Date | null {
  const day = DateTime.fromISO(dayYmd, { zone }).startOf('day');
  if (!day.isValid) return null;
  return day.plus({ minutes }).toJSDate();
}

function freeGaps(window: ScheduleWindow, busy: readonly ScheduleWindow[]): ScheduleWindow[] {
  const clipped = busy
    .map((block) => ({
      startMin: Math.max(block.startMin, window.startMin),
      endMin: Math.min(block.endMin, window.endMin),
    }))
    .filter((block) => block.endMin > block.startMin)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const merged: ScheduleWindow[] = [];
  for (const block of clipped) {
    const last = merged[merged.length - 1];
    if (!last || block.startMin > last.endMin) merged.push({ ...block });
    else last.endMin = Math.max(last.endMin, block.endMin);
  }
  const gaps: ScheduleWindow[] = [];
  let cursor = window.startMin;
  for (const block of merged) {
    if (block.startMin > cursor) gaps.push({ startMin: cursor, endMin: block.startMin });
    cursor = Math.max(cursor, block.endMin);
  }
  if (cursor < window.endMin) gaps.push({ startMin: cursor, endMin: window.endMin });
  return gaps;
}

function fits(gap: ScheduleWindow, minutes: number, ranges: readonly ScheduleWindow[] | null): number | null {
  if (ranges === null) return gap.endMin - gap.startMin >= minutes ? gap.startMin : null;
  for (const range of ranges) {
    const start = Math.max(gap.startMin, range.startMin);
    const end = Math.min(gap.endMin, range.endMin);
    if (end - start >= minutes) return start;
  }
  return null;
}

function earliestFit(gaps: readonly ScheduleWindow[], minutes: number, ranges: readonly ScheduleWindow[] | null): number | null {
  let best: number | null = null;
  for (const gap of gaps) {
    const start = fits(gap, minutes, ranges);
    if (start === null) continue;
    if (best === null || start < best) best = start;
  }
  return best;
}

function consume(gaps: ScheduleWindow[], start: number, minutes: number): void {
  const end = start + minutes;
  const index = gaps.findIndex((gap) => start >= gap.startMin && end <= gap.endMin);
  if (index < 0) return;
  const gap = gaps[index];
  if (!gap) return;
  const next: ScheduleWindow[] = [];
  if (start > gap.startMin) next.push({ startMin: gap.startMin, endMin: start });
  if (end < gap.endMin) next.push({ startMin: end, endMin: gap.endMin });
  gaps.splice(index, 1, ...next);
}

/**
 * First-fit by priority into the work window minus busy blocks.
 * `preferred` is an optional rhythm window. Omit it when there is no profile;
 * placement then uses the work window only.
 * A task that does not fit is returned as 放不下. It is not dropped.
 */
export function proposeSchedule(input: {
  window: ScheduleWindow;
  dayCapMinutes: number;
  busy: readonly ScheduleWindow[];
  candidates: readonly ScheduleCandidate[];
  preferred?: readonly ScheduleWindow[];
}): ScheduleProposal {
  const ordered = [...input.candidates].sort(
    (a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'zh') || a.id.localeCompare(b.id),
  );
  if (!(input.window.endMin > input.window.startMin)) {
    return { placed: [], unplaced: ordered.map((task) => ({ id: task.id, title: task.title, reason: '放不下' })) };
  }
  const gaps = freeGaps(input.window, input.busy);
  const preferred = input.preferred?.filter((range) => range.endMin > range.startMin) ?? [];
  const placed: SchedulePlacement[] = [];
  const unplaced: ScheduleUnplaced[] = [];
  let capLeft = input.dayCapMinutes;
  for (const task of ordered) {
    if (!(task.minutes > 0) || task.minutes > capLeft) {
      unplaced.push({ id: task.id, title: task.title, reason: '放不下' });
      continue;
    }
    const preferredStart = preferred.length > 0 ? earliestFit(gaps, task.minutes, preferred) : null;
    const start = preferredStart ?? earliestFit(gaps, task.minutes, null);
    if (start === null) {
      unplaced.push({ id: task.id, title: task.title, reason: '放不下' });
      continue;
    }
    consume(gaps, start, task.minutes);
    capLeft -= task.minutes;
    placed.push({ id: task.id, title: task.title, startMin: start, endMin: start + task.minutes });
  }
  placed.sort((a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id));
  return { placed, unplaced };
}
