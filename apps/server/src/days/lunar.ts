import { Lunar, LunarYear, Solar } from 'lunar-typescript';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function parseYmd(ymd: string): { y: number; m: number; d: number } {
  if (!YMD.test(ymd)) throw new Error(`invalid ymd ${ymd}`);
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  return { y, m, d };
}

export function padYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const { y, m, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return padYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysBetweenYmd(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

export function isGregorianLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function solarInYear(year: number, month: number, day: number): string {
  if (month === 2 && day === 29 && !isGregorianLeap(year)) return padYmd(year, 2, 28);
  const last = daysInMonth(year, month);
  return padYmd(year, month, Math.min(day, last));
}

export function leapMonthOf(year: number): number | null {
  const month = LunarYear.fromYear(year).getLeapMonth();
  return month > 0 ? month : null;
}

export function lunarToSolar(
  year: number,
  month: number,
  day: number,
  leap: boolean,
): string | null {
  const encoded = leap ? -month : month;
  for (let d = day; d >= 1; d -= 1) {
    try {
      return Lunar.fromYmd(year, encoded, d).getSolar().toYmd();
    } catch {
      continue;
    }
  }
  return null;
}

export function solarToLunar(ymd: string): {
  year: number;
  month: number;
  day: number;
  leap: boolean;
  label: string;
} {
  const { y, m, d } = parseYmd(ymd);
  const lunar = Solar.fromYmd(y, m, d).getLunar();
  const month = lunar.getMonth();
  return {
    year: lunar.getYear(),
    month: Math.abs(month),
    day: lunar.getDay(),
    leap: month < 0,
    label: `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
  };
}

export function lunarLabelOf(ymd: string): string {
  return solarToLunar(ymd).label;
}

export function jieqiYmd(year: number, name: string, month: number, fromDay: number, toDay: number): string {
  for (let d = fromDay; d <= toDay; d += 1) {
    const solar = Solar.fromYmd(year, month, d);
    if (solar.getLunar().getJieQi() === name) return solar.toYmd();
  }
  return padYmd(year, month, fromDay);
}

export function nthWeekdayYmd(year: number, month: number, weekday: number, nth: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  let delta = weekday - firstDow;
  if (delta < 0) delta += 7;
  const day = 1 + delta + (nth - 1) * 7;
  return padYmd(year, month, day);
}

export function nextSolarYearly(month: number, day: number, fromYmd: string): string {
  const { y } = parseYmd(fromYmd);
  for (let year = y; year <= y + 2; year += 1) {
    const cand = solarInYear(year, month, day);
    if (cand >= fromYmd) return cand;
  }
  return solarInYear(y + 3, month, day);
}

export function prevSolarYearly(month: number, day: number, fromYmd: string): string {
  const { y } = parseYmd(fromYmd);
  for (let year = y; year >= y - 2; year -= 1) {
    const cand = solarInYear(year, month, day);
    if (cand <= fromYmd) return cand;
  }
  return solarInYear(y - 3, month, day);
}

export function nextLunarYearly(
  month: number,
  day: number,
  leapPreferred: boolean,
  fromYmd: string,
): string {
  const { y } = parseYmd(fromYmd);
  for (let year = y - 1; year <= y + 3; year += 1) {
    const useLeap = leapPreferred && leapMonthOf(year) === month;
    const cand = lunarToSolar(year, month, day, useLeap);
    if (cand && cand >= fromYmd) return cand;
  }
  return fromYmd;
}

export function prevLunarYearly(
  month: number,
  day: number,
  leapPreferred: boolean,
  fromYmd: string,
): string {
  const { y } = parseYmd(fromYmd);
  for (let year = y + 1; year >= y - 3; year -= 1) {
    const useLeap = leapPreferred && leapMonthOf(year) === month;
    const cand = lunarToSolar(year, month, day, useLeap);
    if (cand && cand <= fromYmd) return cand;
  }
  return fromYmd;
}

export function nextByYearFn(occurrenceInYear: (year: number) => string, fromYmd: string): string {
  const { y } = parseYmd(fromYmd);
  for (let year = y; year <= y + 3; year += 1) {
    const cand = occurrenceInYear(year);
    if (cand >= fromYmd) return cand;
  }
  return occurrenceInYear(y + 4);
}

export function prevByYearFn(occurrenceInYear: (year: number) => string, fromYmd: string): string {
  const { y } = parseYmd(fromYmd);
  for (let year = y; year >= y - 3; year -= 1) {
    const cand = occurrenceInYear(year);
    if (cand <= fromYmd) return cand;
  }
  return occurrenceInYear(y - 4);
}
