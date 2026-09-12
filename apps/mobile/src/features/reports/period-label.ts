import type { ReportType } from '@vital/dto';

/** ISO 8601 week number of a YYYY-MM-DD date. */
export function isoWeek(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const day = (date.getUTCDay() + 6) % 7; // Mon = 0
  date.setUTCDate(date.getUTCDate() - day + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fd = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fd + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

/** Local device date as YYYY-MM-DD. */
export function todayYmd(now: Date = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

/** 「周六」 style label; names indexed by Date.getDay() (Sun first). */
export function weekdayLabel(ymd: string, names: readonly string[]): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay();
  return `周${names[dow] ?? ''}`;
}

/** Mono period meta row: daily `2026-09-12 · 周六`, weekly `09-07 – 09-13 · W37`. */
export function formatPeriodMeta(
  type: ReportType,
  start: string,
  end: string,
  weekday: (ymd: string) => string,
): string {
  if (type === 'daily') return `${start} · ${weekday(start)}`;
  if (type === 'monthly') return start.slice(0, 7);
  if (type === 'yearly') return start.slice(0, 4);
  const last = addDaysYmd(end, -1);
  return `${start.slice(5)} – ${last.slice(5)} · W${isoWeek(start)}`;
}

/** HH:mm local clock for an ISO timestamp or epoch ms. */
export function clockTime(value: string | number): string {
  const date = new Date(value);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 最近完成右侧时间：今天 HH:mm，昨天「昨天」，更早 MM-DD。 */
export function recentTimeLabel(iso: string, yesterday: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const day = todayYmd(date);
  const today = todayYmd(now);
  if (day === today) return clockTime(iso);
  if (day === addDaysYmd(today, -1)) return yesterday;
  return day.slice(5);
}

/** Monday-first column index (0..6) of a YYYY-MM-DD date. */
export function mondayFirstCol(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return (new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7;
}

/** Absolute heat alpha per spec: 0.18 + 0.62 × min(n,5)/5 → 2-digit hex channel. */
export function heatAlphaHex(completed: number): string {
  const alpha = 0.18 + (0.62 * Math.min(completed, 5)) / 5;
  return Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
}
