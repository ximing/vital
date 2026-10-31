import { isSlotMinute, type HourCell, type SlotMinute } from './gesture';

/** Height of one 15-minute row on the phone time grid. */
export const QUARTER_H = 28;
/** Width of the hour gutter. */
export const HOUR_GUTTER = 48;
export const DAY_QUARTERS = 24 * 4;
export const GRID_HEIGHT = DAY_QUARTERS * QUARTER_H;

export type Viewport = {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
};

/** Quarter under a finger in the scrolling time grid. `scrollY` is the grid's content offset. */
export function hourCellAt(
  viewport: Viewport,
  scrollY: number,
  days: readonly string[],
  pageX: number,
  pageY: number,
): HourCell | null {
  if (days.length === 0 || viewport.width <= HOUR_GUTTER) return null;
  const x = pageX - viewport.pageX;
  const y = pageY - viewport.pageY + scrollY;
  if (x < HOUR_GUTTER || y < 0 || y >= GRID_HEIGHT) return null;
  const colW = (viewport.width - HOUR_GUTTER) / days.length;
  if (colW <= 0) return null;
  const index = Math.min(days.length - 1, Math.floor((x - HOUR_GUTTER) / colW));
  const ymd = days[index];
  if (ymd === undefined) return null;
  const slot = Math.floor(y / QUARTER_H);
  if (slot < 0 || slot >= DAY_QUARTERS) return null;
  const minute = (slot % 4) * 15;
  if (!isSlotMinute(minute)) return null;
  return { kind: 'hour', ymd, hour: Math.floor(slot / 4), minute };
}

export type BandMetrics = {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
  days: readonly string[];
};

/** Day under a finger in the all-day band. The gutter does not hit a day. */
export function bandDayAt(band: BandMetrics, pageX: number, pageY: number): string | null {
  if (band.days.length === 0 || band.width <= HOUR_GUTTER || band.height <= 0) return null;
  const x = pageX - band.pageX;
  const y = pageY - band.pageY;
  if (x < HOUR_GUTTER || y < 0 || y >= band.height) return null;
  const colW = (band.width - HOUR_GUTTER) / band.days.length;
  if (colW <= 0) return null;
  const index = Math.min(band.days.length - 1, Math.floor((x - HOUR_GUTTER) / colW));
  return band.days[index] ?? null;
}

export type MonthMetrics = {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
  /** 42 local dates, row-major, matching the month placement. */
  ymds: readonly string[];
};

/** Day under a finger in the 7-by-6 month grid. */
export function monthDayAt(grid: MonthMetrics, pageX: number, pageY: number): string | null {
  if (grid.ymds.length !== 42 || grid.width <= 0 || grid.height <= 0) return null;
  const x = pageX - grid.pageX;
  const y = pageY - grid.pageY;
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  const col = Math.min(6, Math.floor((x / grid.width) * 7));
  const row = Math.min(5, Math.floor((y / grid.height) * 6));
  return grid.ymds[row * 7 + col] ?? null;
}

export function quarterTop(hour: number, minute: SlotMinute): number {
  return (hour * 4 + minute / 15) * QUARTER_H;
}
