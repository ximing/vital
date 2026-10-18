import { addDaysYmd, DEVICE_CALENDAR_SYNC_DAYS, localTodayYmd } from '@vital/dto';

export {
  clothingSuggestion,
  describeTodayLayoutFacts,
  nearestStatutoryHoliday,
  normalizeCalendarEvent,
  normalizeTodayLayout,
  todayModulesOrFallback,
  upcomingExcludingToday,
  ymdInTimeZone,
} from '@vital/dto';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Android only returns events that sit entirely inside the query. Look back so a multi-day event still overlaps today. */
const LOOKBACK_DAYS = 30;

export function localDayBounds(timeZone: string, now = new Date()): { start: Date; end: Date } {
  const today = localTodayYmd(timeZone, now);
  return {
    start: zonedMidnight(today, timeZone),
    end: zonedMidnight(addDaysYmd(today, 1), timeZone),
  };
}

export function calendarQueryWindow(day: { start: Date; end: Date }): { start: Date; end: Date } {
  return {
    start: new Date(day.start.getTime() - LOOKBACK_DAYS * DAY_MS),
    end: new Date(day.start.getTime() + DEVICE_CALENDAR_SYNC_DAYS * DAY_MS),
  };
}

/** True when the event overlaps [dayStart, dayEnd). An event that starts at dayEnd belongs to the next day. */
export function eventOverlapsDay(startIso: string, endIso: string, dayStart: Date, dayEnd: Date): boolean {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return start < dayEnd.getTime() && end > dayStart.getTime();
}

function zonedMidnight(ymd: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return new Date(NaN);
  const utcGuess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const offset = zoneOffsetMs(utcGuess, timeZone);
  let instant = utcGuess - offset;
  const corrected = zoneOffsetMs(instant, timeZone);
  if (corrected !== offset) instant = utcGuess - corrected;
  return new Date(instant);
}

function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMs));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '0';
  let hour = pick('hour');
  if (hour === '24') hour = '0';
  const asUtc = Date.UTC(
    Number(pick('year')),
    Number(pick('month')) - 1,
    Number(pick('day')),
    Number(hour),
    Number(pick('minute')),
    Number(pick('second')),
  );
  return asUtc - utcMs;
}

export { groupTodayModuleRows } from '@vital/dto';
