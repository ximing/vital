import type { Day, DayDisplayMode, DayReminderOffset, DayRepeat } from '@vital/dto';
import { t } from '@/copy';
import { ymdDiffDays } from './timeline';

export function headlineText(day: Day): string {
  if (day.headline.kind === 'today') return t.days.today;
  if (day.headline.kind === 'countdown') {
    return t.days.countdown.replace('{n}', String(day.headline.days));
  }
  return t.days.countup.replace('{n}', String(day.headline.days));
}

export function yearsText(day: Day): string | null {
  if (day.headline.years === null || day.headline.years < 1) return null;
  return t.days.yearNth.replace('{n}', String(day.headline.years));
}

export function pickNextUp(days: readonly Day[]): Day | null {
  let best: Day | null = null;
  for (const day of days) {
    if (day.headline.kind !== 'countdown') continue;
    if (best === null || day.headline.days < best.headline.days) best = day;
  }
  return best;
}

export function shortYmd(ymd: string, todayYmd: string): string {
  return ymd.slice(0, 4) === todayYmd.slice(0, 4) ? ymd.slice(5) : ymd;
}

export function holidayChipText(from: string, to: string, todayYmd: string): string {
  return t.days.holidayRange
    .replace('{from}', shortYmd(from, todayYmd))
    .replace('{to}', shortYmd(to, todayYmd));
}

const REMINDER_LABEL: Record<DayReminderOffset, string> = {
  0: t.days.reminderOnDay,
  1: t.days.reminder1,
  3: t.days.reminder3,
  7: t.days.reminder7,
  30: t.days.reminder30,
};

export function reminderChipText(offsets: readonly DayReminderOffset[]): string | null {
  if (offsets.length === 0) return null;
  const min = Math.min(...offsets) as DayReminderOffset;
  return t.days.reminderChip.replace('{label}', REMINDER_LABEL[min]);
}

export type DayFilter = 'all' | 'countdown' | 'countup' | 'festival';

export function matchesFilter(day: Day, filter: DayFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'festival') return day.source !== 'custom';
  if (filter === 'countdown') return day.headline.kind === 'countdown' || day.headline.kind === 'today';
  return day.headline.kind === 'countup';
}

const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'] as const;
const LUNAR_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

function lunarDayLabel(day: number): string {
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  if (day >= 1 && day <= 9) return `初${LUNAR_DIGITS[day - 1]}`;
  if (day >= 11 && day <= 19) return `十${LUNAR_DIGITS[day - 11]}`;
  if (day >= 21 && day <= 29) return `廿${LUNAR_DIGITS[day - 21]}`;
  return String(day);
}

export function lunarDateLabel(month: number, day: number, leap: boolean): string {
  const monthLabel = LUNAR_MONTHS[month - 1] ?? String(month);
  return `${t.days.lunar}${leap ? t.days.lunarLeapMark : ''}${monthLabel}月${lunarDayLabel(day)}`;
}

export type CoverMetaDraft = {
  calendar: 'solar' | 'lunar';
  anchorYmd: string;
  lunarMonth: number;
  lunarDay: number;
  lunarLeap: boolean;
  repeat: DayRepeat;
  displayMode: DayDisplayMode;
};

function nextFocusYmd(anchorYmd: string, repeat: DayRepeat, todayYmd: string): string | null {
  if (repeat === 'none') return anchorYmd >= todayYmd ? anchorYmd : null;
  const md = anchorYmd.slice(5);
  if (!/^\d{2}-\d{2}$/.test(md)) return anchorYmd >= todayYmd ? anchorYmd : null;
  const year = Number(todayYmd.slice(0, 4));
  const thisYear = `${String(year).padStart(4, '0')}-${md}`;
  if (thisYear >= todayYmd) return thisYear;
  return `${String(year + 1).padStart(4, '0')}-${md}`;
}

export function draftHeadlineText(draft: CoverMetaDraft, todayYmd: string): string {
  if (draft.displayMode === 'countup') {
    return t.days.countup.replace('{n}', String(Math.max(0, ymdDiffDays(draft.anchorYmd, todayYmd))));
  }
  const next = nextFocusYmd(draft.anchorYmd, draft.repeat, todayYmd);
  if (next === todayYmd) return t.days.today;
  if (next !== null) return t.days.countdown.replace('{n}', String(ymdDiffDays(todayYmd, next)));
  return t.days.countup.replace('{n}', String(Math.max(0, ymdDiffDays(draft.anchorYmd, todayYmd))));
}

export function draftCoverMeta(draft: CoverMetaDraft, todayYmd: string): string {
  const parts: string[] = [];
  if (draft.anchorYmd !== '') parts.push(draft.anchorYmd);
  if (draft.calendar === 'lunar') {
    parts.push(lunarDateLabel(draft.lunarMonth, draft.lunarDay, draft.lunarLeap));
  }
  parts.push(draftHeadlineText(draft, todayYmd));
  return parts.join(' · ');
}
