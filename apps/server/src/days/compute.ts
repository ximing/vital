import type { CoverPreset, DayCalendar, DayDisplayMode, DayHeadline, DayRepeat } from '@vital/dto';
import { catalogByKey } from './catalog.js';
import {
  addDaysYmd,
  daysBetweenYmd,
  lunarLabelOf,
  lunarToSolar,
  nextByYearFn,
  nextLunarYearly,
  nextSolarYearly,
  parseYmd,
  prevByYearFn,
  prevLunarYearly,
  prevSolarYearly,
  solarToLunar,
} from './lunar.js';

export type DayOccurrenceInput = {
  calendar: DayCalendar;
  repeat: DayRepeat;
  displayMode: DayDisplayMode;
  anchorYmd: string;
  lunarMonth: number | null;
  lunarDay: number | null;
  lunarLeap: boolean;
  catalogKey: string | null;
};

export type DayOccurrence = {
  nextYmd: string | null;
  prevYmd: string;
  headline: DayHeadline;
  lunarLabel: string | null;
  solarLabel: string;
};

function solarMonthDay(ymd: string): { month: number; day: number } {
  const { m, d } = parseYmd(ymd);
  return { month: m, day: d };
}

function nextOf(input: DayOccurrenceInput, fromYmd: string): string | null {
  if (input.repeat === 'none') {
    return input.anchorYmd >= fromYmd ? input.anchorYmd : null;
  }
  const catalog = input.catalogKey ? catalogByKey(input.catalogKey) : undefined;
  if (catalog) return nextByYearFn(catalog.occurrenceInYear, fromYmd);
  if (input.calendar === 'lunar' && input.lunarMonth !== null && input.lunarDay !== null) {
    return nextLunarYearly(input.lunarMonth, input.lunarDay, input.lunarLeap, fromYmd);
  }
  const { month, day } = solarMonthDay(input.anchorYmd);
  return nextSolarYearly(month, day, fromYmd);
}

function prevOf(input: DayOccurrenceInput, fromYmd: string): string {
  if (input.repeat === 'none') return input.anchorYmd;
  const catalog = input.catalogKey ? catalogByKey(input.catalogKey) : undefined;
  if (catalog) return prevByYearFn(catalog.occurrenceInYear, fromYmd);
  if (input.calendar === 'lunar' && input.lunarMonth !== null && input.lunarDay !== null) {
    return prevLunarYearly(input.lunarMonth, input.lunarDay, input.lunarLeap, fromYmd);
  }
  const { month, day } = solarMonthDay(input.anchorYmd);
  return prevSolarYearly(month, day, fromYmd);
}

function completedYears(input: DayOccurrenceInput, today: string): number | null {
  if (input.repeat !== 'yearly') return null;
  if (today < input.anchorYmd) return null;
  let n = 0;
  let cursor = nextOf(input, addDaysYmd(input.anchorYmd, 1));
  while (cursor && cursor <= today && n < 200) {
    n += 1;
    cursor = nextOf(input, addDaysYmd(cursor, 1));
  }
  return n > 0 ? n : null;
}

function headlineOf(
  input: DayOccurrenceInput,
  today: string,
  nextYmd: string | null,
  years: number | null,
): DayHeadline {
  const mode = input.displayMode;
  if (mode === 'countup') {
    return { kind: 'countup', days: Math.max(0, daysBetweenYmd(input.anchorYmd, today)), years };
  }
  if (nextYmd === today) return { kind: 'today', days: 0, years };
  if (nextYmd !== null) {
    return { kind: 'countdown', days: daysBetweenYmd(today, nextYmd), years };
  }
  return { kind: 'countup', days: Math.max(0, daysBetweenYmd(input.anchorYmd, today)), years };
}

export function solarLabelOf(ymd: string): string {
  const { y, m, d } = parseYmd(ymd);
  return `${String(y)}年${String(m)}月${String(d)}日`;
}

export function computeOccurrence(input: DayOccurrenceInput, today: string): DayOccurrence {
  const nextYmd = nextOf(input, today);
  const prevYmd = prevOf(input, today);
  const years = completedYears(input, today);
  const focus = nextYmd ?? prevYmd;
  return {
    nextYmd,
    prevYmd,
    headline: headlineOf(input, today, nextYmd, years),
    lunarLabel: input.calendar === 'lunar' || Boolean(input.catalogKey && catalogByKey(input.catalogKey)?.calendar === 'lunar')
      ? lunarLabelOf(focus)
      : null,
    solarLabel: solarLabelOf(focus),
  };
}

export function resolveCustomAnchor(input: {
  calendar: DayCalendar;
  anchorYmd?: string | undefined;
  lunarYear?: number | undefined;
  lunarMonth?: number | null | undefined;
  lunarDay?: number | null | undefined;
  lunarLeap?: boolean | undefined;
}): { anchorYmd: string; lunarMonth: number | null; lunarDay: number | null; lunarLeap: boolean } {
  if (input.calendar === 'lunar') {
    const year = input.lunarYear;
    const month = input.lunarMonth;
    const day = input.lunarDay;
    if (year === undefined || month === null || month === undefined || day === null || day === undefined) {
      throw new Error('lunar fields required');
    }
    const leap = input.lunarLeap === true;
    const ymd = lunarToSolar(year, month, day, leap);
    if (!ymd) throw new Error('invalid lunar date');
    return { anchorYmd: ymd, lunarMonth: month, lunarDay: day, lunarLeap: leap };
  }
  if (!input.anchorYmd) throw new Error('anchorYmd required');
  return { anchorYmd: input.anchorYmd, lunarMonth: null, lunarDay: null, lunarLeap: false };
}

export function lunarFieldsFromSolar(ymd: string): {
  lunarMonth: number;
  lunarDay: number;
  lunarLeap: boolean;
} {
  const lunar = solarToLunar(ymd);
  return { lunarMonth: lunar.month, lunarDay: lunar.day, lunarLeap: lunar.leap };
}

export function guessCoverPreset(name: string): CoverPreset {
  if (/春|年|灯|除夕/.test(name)) return 'lantern';
  if (/国庆|红/.test(name)) return 'silk';
  if (/中秋|月/.test(name)) return 'moon';
  if (/清明|柳/.test(name)) return 'willow';
  if (/端午|舟|河/.test(name)) return 'river';
  if (/劳动|麦/.test(name)) return 'field';
  if (/爱|情人|在一起/.test(name)) return 'tea';
  if (/生日|花/.test(name)) return 'blossom';
  if (/圣诞|冬|雪/.test(name)) return 'snow';
  if (/夜/.test(name)) return 'night';
  return 'mist';
}
