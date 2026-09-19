export function ymdParts(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

export function padYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addMonthsYmd(ymd: string, delta: number): string {
  const { y, m, d } = ymdParts(ymd);
  const dt = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  return padYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, Math.min(d, last));
}

/** Day-precision shift; `delta` may be negative. */
export function addDaysYmd(ymd: string, delta: number): string {
  const { y, m, d } = ymdParts(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return padYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** 42 cells (6 weeks). `weekStartsOn`: 0 Sunday, 1 Monday. */
export function monthGrid(year: number, month: number, weekStartsOn: 0 | 1): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  let lead = firstDow - weekStartsOn;
  if (lead < 0) lead += 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < 42; i += 1) {
    const day = i - lead + 1;
    cells.push(day >= 1 && day <= days ? padYmd(year, month, day) : null);
  }
  return cells;
}

export type CalendarView = 'date' | 'month' | 'year';

const MONTHS_BY_VIEW: Record<CalendarView, { inner: number; super: number }> = {
  date: { inner: 1, super: 12 },
  month: { inner: 12, super: 120 },
  year: { inner: 120, super: 1200 },
};

export function shiftCalendarCursor(
  ymd: string,
  view: CalendarView,
  step: 'inner' | 'super',
  dir: -1 | 1,
): string {
  return addMonthsYmd(ymd, MONTHS_BY_VIEW[view][step] * dir);
}

export function decadeStart(year: number): number {
  return Math.floor(year / 10) * 10;
}

/** Decade years plus one neighbour on each side (12 cells). */
export function yearPanelYears(year: number): number[] {
  const start = decadeStart(year);
  return Array.from({ length: 12 }, (_, i) => start - 1 + i);
}
