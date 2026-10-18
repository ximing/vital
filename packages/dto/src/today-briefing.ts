/** Statutory dates for the today briefing.
 *  Mirrors apps/server/src/days/catalog.ts (元旦, 春节, 清明节, 劳动节, 端午节, 中秋节, 国庆节)
 *  for 2020–2040, including lunar occurrences from lunar-typescript. Years outside the table
 *  fall back to the fixed solar holidays so a year roll to 元旦 still resolves.
 */

export const STATUTORY_HOLIDAY_NAMES = [
  '元旦',
  '春节',
  '清明节',
  '劳动节',
  '端午节',
  '中秋节',
  '国庆节',
] as const;

export type StatutoryHolidayName = (typeof STATUTORY_HOLIDAY_NAMES)[number];

export type StatutoryHoliday = {
  name: StatutoryHolidayName;
  date: string;
};

const STATUTORY_BY_YEAR: Record<number, readonly (readonly [StatutoryHolidayName, string])[]> = {
  2020: [
    ["元旦", "2020-01-01"],
    ["春节", "2020-01-25"],
    ["清明节", "2020-04-04"],
    ["劳动节", "2020-05-01"],
    ["端午节", "2020-06-25"],
    ["中秋节", "2020-10-01"],
    ["国庆节", "2020-10-01"],
  ],
  2021: [
    ["元旦", "2021-01-01"],
    ["春节", "2021-02-12"],
    ["清明节", "2021-04-04"],
    ["劳动节", "2021-05-01"],
    ["端午节", "2021-06-14"],
    ["中秋节", "2021-09-21"],
    ["国庆节", "2021-10-01"],
  ],
  2022: [
    ["元旦", "2022-01-01"],
    ["春节", "2022-02-01"],
    ["清明节", "2022-04-05"],
    ["劳动节", "2022-05-01"],
    ["端午节", "2022-06-03"],
    ["中秋节", "2022-09-10"],
    ["国庆节", "2022-10-01"],
  ],
  2023: [
    ["元旦", "2023-01-01"],
    ["春节", "2023-01-22"],
    ["清明节", "2023-04-05"],
    ["劳动节", "2023-05-01"],
    ["端午节", "2023-06-22"],
    ["中秋节", "2023-09-29"],
    ["国庆节", "2023-10-01"],
  ],
  2024: [
    ["元旦", "2024-01-01"],
    ["春节", "2024-02-10"],
    ["清明节", "2024-04-04"],
    ["劳动节", "2024-05-01"],
    ["端午节", "2024-06-10"],
    ["中秋节", "2024-09-17"],
    ["国庆节", "2024-10-01"],
  ],
  2025: [
    ["元旦", "2025-01-01"],
    ["春节", "2025-01-29"],
    ["清明节", "2025-04-04"],
    ["劳动节", "2025-05-01"],
    ["端午节", "2025-05-31"],
    ["中秋节", "2025-10-06"],
    ["国庆节", "2025-10-01"],
  ],
  2026: [
    ["元旦", "2026-01-01"],
    ["春节", "2026-02-17"],
    ["清明节", "2026-04-05"],
    ["劳动节", "2026-05-01"],
    ["端午节", "2026-06-19"],
    ["中秋节", "2026-09-25"],
    ["国庆节", "2026-10-01"],
  ],
  2027: [
    ["元旦", "2027-01-01"],
    ["春节", "2027-02-06"],
    ["清明节", "2027-04-05"],
    ["劳动节", "2027-05-01"],
    ["端午节", "2027-06-09"],
    ["中秋节", "2027-09-15"],
    ["国庆节", "2027-10-01"],
  ],
  2028: [
    ["元旦", "2028-01-01"],
    ["春节", "2028-01-26"],
    ["清明节", "2028-04-04"],
    ["劳动节", "2028-05-01"],
    ["端午节", "2028-05-28"],
    ["中秋节", "2028-10-03"],
    ["国庆节", "2028-10-01"],
  ],
  2029: [
    ["元旦", "2029-01-01"],
    ["春节", "2029-02-13"],
    ["清明节", "2029-04-04"],
    ["劳动节", "2029-05-01"],
    ["端午节", "2029-06-16"],
    ["中秋节", "2029-09-22"],
    ["国庆节", "2029-10-01"],
  ],
  2030: [
    ["元旦", "2030-01-01"],
    ["春节", "2030-02-03"],
    ["清明节", "2030-04-05"],
    ["劳动节", "2030-05-01"],
    ["端午节", "2030-06-05"],
    ["中秋节", "2030-09-12"],
    ["国庆节", "2030-10-01"],
  ],
  2031: [
    ["元旦", "2031-01-01"],
    ["春节", "2031-01-23"],
    ["清明节", "2031-04-05"],
    ["劳动节", "2031-05-01"],
    ["端午节", "2031-06-24"],
    ["中秋节", "2031-10-01"],
    ["国庆节", "2031-10-01"],
  ],
  2032: [
    ["元旦", "2032-01-01"],
    ["春节", "2032-02-11"],
    ["清明节", "2032-04-04"],
    ["劳动节", "2032-05-01"],
    ["端午节", "2032-06-12"],
    ["中秋节", "2032-09-19"],
    ["国庆节", "2032-10-01"],
  ],
  2033: [
    ["元旦", "2033-01-01"],
    ["春节", "2033-01-31"],
    ["清明节", "2033-04-04"],
    ["劳动节", "2033-05-01"],
    ["端午节", "2033-06-01"],
    ["中秋节", "2033-09-08"],
    ["国庆节", "2033-10-01"],
  ],
  2034: [
    ["元旦", "2034-01-01"],
    ["春节", "2034-02-19"],
    ["清明节", "2034-04-05"],
    ["劳动节", "2034-05-01"],
    ["端午节", "2034-06-20"],
    ["中秋节", "2034-09-27"],
    ["国庆节", "2034-10-01"],
  ],
  2035: [
    ["元旦", "2035-01-01"],
    ["春节", "2035-02-08"],
    ["清明节", "2035-04-05"],
    ["劳动节", "2035-05-01"],
    ["端午节", "2035-06-10"],
    ["中秋节", "2035-09-16"],
    ["国庆节", "2035-10-01"],
  ],
  2036: [
    ["元旦", "2036-01-01"],
    ["春节", "2036-01-28"],
    ["清明节", "2036-04-04"],
    ["劳动节", "2036-05-01"],
    ["端午节", "2036-05-30"],
    ["中秋节", "2036-10-04"],
    ["国庆节", "2036-10-01"],
  ],
  2037: [
    ["元旦", "2037-01-01"],
    ["春节", "2037-02-15"],
    ["清明节", "2037-04-04"],
    ["劳动节", "2037-05-01"],
    ["端午节", "2037-06-18"],
    ["中秋节", "2037-09-24"],
    ["国庆节", "2037-10-01"],
  ],
  2038: [
    ["元旦", "2038-01-01"],
    ["春节", "2038-02-04"],
    ["清明节", "2038-04-05"],
    ["劳动节", "2038-05-01"],
    ["端午节", "2038-06-07"],
    ["中秋节", "2038-09-13"],
    ["国庆节", "2038-10-01"],
  ],
  2039: [
    ["元旦", "2039-01-01"],
    ["春节", "2039-01-24"],
    ["清明节", "2039-04-05"],
    ["劳动节", "2039-05-01"],
    ["端午节", "2039-05-27"],
    ["中秋节", "2039-10-02"],
    ["国庆节", "2039-10-01"],
  ],
  2040: [
    ["元旦", "2040-01-01"],
    ["春节", "2040-02-12"],
    ["清明节", "2040-04-04"],
    ["劳动节", "2040-05-01"],
    ["端午节", "2040-06-14"],
    ["中秋节", "2040-09-20"],
    ["国庆节", "2040-10-01"],
  ],
};

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function solarFallback(year: number): StatutoryHoliday[] {
  const y = String(year).padStart(4, '0');
  return [
    { name: '元旦', date: `${y}-01-01` },
    { name: '劳动节', date: `${y}-05-01` },
    { name: '国庆节', date: `${y}-10-01` },
  ];
}

function holidaysInYear(year: number): StatutoryHoliday[] {
  const rows = STATUTORY_BY_YEAR[year];
  if (!rows) return solarFallback(year);
  return rows.map(([name, date]) => ({ name, date }));
}

/** Nearest statutory holiday on or after `todayYmd` (YYYY-MM-DD). A holiday today wins. */
export function nearestStatutoryHoliday(todayYmd: string): StatutoryHoliday {
  const match = YMD.exec(todayYmd);
  const year = match ? Number(match[1]) : 2026;
  const today = match ? todayYmd : `${String(year).padStart(4, '0')}-01-01`;
  const pool = [...holidaysInYear(year), ...holidaysInYear(year + 1), ...holidaysInYear(year + 2)];
  const upcoming = pool.filter((item) => item.date >= today);
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'zh'));
  const first = upcoming[0] ?? { name: '元旦' as const, date: `${String(year + 1).padStart(4, '0')}-01-01` };
  const sameDay = upcoming.filter((item) => item.date === first.date);
  return sameDay.find((item) => item.name === '国庆节') ?? first;
}

export type ClothingBand = 'hot-dry' | 'cold' | 'rain' | 'snow' | 'mild';

export type WeatherSample = {
  temperatureC: number;
  weatherCode: number;
};

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

export type WeatherConditionKey = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'overcast';

export function weatherConditionKey(weatherCode: number): WeatherConditionKey {
  if (SNOW_CODES.has(weatherCode)) return 'snow';
  if (RAIN_CODES.has(weatherCode)) return 'rain';
  if (weatherCode === 0) return 'clear';
  if (weatherCode === 1 || weatherCode === 2 || weatherCode === 3) return 'cloudy';
  if (weatherCode === 45 || weatherCode === 48) return 'fog';
  return 'overcast';
}

/** Hot and dry stays off outerwear. Cold asks for a coat. Rain and snow name that protection. */
export function clothingSuggestion(sample: WeatherSample): ClothingBand {
  const code = sample.weatherCode;
  if (SNOW_CODES.has(code)) return 'snow';
  if (RAIN_CODES.has(code)) return 'rain';
  if (sample.temperatureC >= 28) return 'hot-dry';
  if (sample.temperatureC <= 10) return 'cold';
  return 'mild';
}

export type GeoPlace = {
  name: string;
  latitude: number;
  longitude: number;
};

function queryString(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function openMeteoForecastUrl(latitude: number, longitude: number): string {
  return `https://api.open-meteo.com/v1/forecast?${queryString({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,weather_code',
    timezone: 'auto',
  })}`;
}

export function openMeteoGeocodeUrl(name: string): string {
  return `https://geocoding-api.open-meteo.com/v1/search?${queryString({
    name,
    count: '1',
    language: 'zh',
    format: 'json',
  })}`;
}

export function parseOpenMeteoForecast(body: unknown): WeatherSample | null {
  if (typeof body !== 'object' || body === null) return null;
  const current = (body as { current?: unknown }).current;
  if (typeof current !== 'object' || current === null) return null;
  const row = current as { temperature_2m?: unknown; weather_code?: unknown };
  if (typeof row.temperature_2m !== 'number' || !Number.isFinite(row.temperature_2m)) return null;
  if (typeof row.weather_code !== 'number' || !Number.isFinite(row.weather_code)) return null;
  return { temperatureC: row.temperature_2m, weatherCode: row.weather_code };
}

function unknownAt(value: unknown, index: number): unknown {
  if (!Array.isArray(value) || index < 0 || index >= value.length) return undefined;
  return (value as readonly unknown[])[index];
}

export function parseOpenMeteoPlace(body: unknown): GeoPlace | null {
  if (typeof body !== 'object' || body === null) return null;
  const results = (body as { results?: unknown }).results;
  const first = unknownAt(results, 0);
  if (typeof first !== 'object' || first === null) return null;
  const row = first as { name?: unknown; latitude?: unknown; longitude?: unknown };
  if (typeof row.name !== 'string' || row.name.trim() === '') return null;
  if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') return null;
  return { name: row.name.trim(), latitude: row.latitude, longitude: row.longitude };
}

export function localTodayYmd(timeZone: string, now = new Date()): string {
  return ymdInTimeZone(now, timeZone);
}

export function ymdInTimeZone(instant: Date | string, timeZone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const match = YMD.exec(ymd);
  if (!match) return ymd;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  const y = String(dt.getUTCFullYear()).padStart(4, '0');
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function localHm(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  let hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  if (hour === '24') hour = '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

export type BriefingTask = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  startAt: string | null;
  habitId?: string | null;
  deletedAt?: string | null;
  /** 0 urgent, 1 high, 2 medium, 3 none. Missing means none. */
  priority?: 0 | 1 | 2 | 3;
  isAllDay?: boolean;
};

function isOpenBriefingTask(task: BriefingTask): boolean {
  return (
    (task.deletedAt === undefined || task.deletedAt === null) &&
    (task.habitId === undefined || task.habitId === null) &&
    task.status !== 'done' &&
    task.status !== 'canceled'
  );
}

export function openTodayTitles(tasks: readonly BriefingTask[]): string[] {
  return tasks.filter(isOpenBriefingTask).map((task) => task.title);
}

export type TodayPlanMark = 'overdue' | 'urgent' | 'high' | 'medium';

export type TodayPlanItem = {
  id: string;
  title: string;
  mark: TodayPlanMark;
  /** Local HH:mm for a timed due. All-day and midnight stay blank. */
  when: string | null;
};

export type TodayPlanCounts = {
  overdue: number;
  urgent: number;
  high: number;
  medium: number;
  plain: number;
};

export type TodayPlan = {
  /** Marked tasks only, at most five. The checklist below still holds every row. */
  items: TodayPlanItem[];
  /** Open tasks not listed in `items`. */
  rest: number;
  titles: string[];
  counts: TodayPlanCounts;
};

const PLAN_LIMIT = 5;
const PLAN_SIGNAL_KEYS = ['overdue', 'urgent', 'high', 'medium'] as const;

/** Non-zero overdue / urgent / high / medium counts, in that order. */
export function planSignalCounts(
  counts: TodayPlanCounts,
): Array<{ key: (typeof PLAN_SIGNAL_KEYS)[number]; n: number }> {
  return PLAN_SIGNAL_KEYS.flatMap((key) => (counts[key] > 0 ? [{ key, n: counts[key] }] : []));
}

function planRank(task: BriefingTask, overdue: boolean): number {
  if (overdue) return 0;
  if (task.priority === 0) return 1;
  if (task.priority === 1) return 2;
  if (task.priority === 2) return 3;
  return 4;
}

function planMark(task: BriefingTask, overdue: boolean): TodayPlanMark | null {
  if (overdue) return 'overdue';
  if (task.priority === 0) return 'urgent';
  if (task.priority === 1) return 'high';
  if (task.priority === 2) return 'medium';
  return null;
}

function planWhen(task: BriefingTask, timeZone: string): string | null {
  if (task.dueAt === null || task.isAllDay) return null;
  const hm = localHm(task.dueAt, timeZone);
  return hm === '00:00' ? null : hm;
}

/** What to do first. Unmarked titles stay in the checklist, so the brief does not repeat them. */
export function buildTodayPlan(
  tasks: readonly BriefingTask[],
  timeZone: string,
  now = new Date(),
): TodayPlan {
  const today = localTodayYmd(timeZone, now);
  const open = tasks.filter(isOpenBriefingTask).map((task) => {
    const overdue = task.dueAt !== null && ymdInTimeZone(task.dueAt, timeZone) < today;
    return { task, overdue, mark: planMark(task, overdue) };
  });
  open.sort((a, b) => {
    const byRank = planRank(a.task, a.overdue) - planRank(b.task, b.overdue);
    if (byRank !== 0) return byRank;
    const aDue = a.task.dueAt ?? '9999';
    const bDue = b.task.dueAt ?? '9999';
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
    return a.task.title.localeCompare(b.task.title, 'zh');
  });
  const counts: TodayPlanCounts = { overdue: 0, urgent: 0, high: 0, medium: 0, plain: 0 };
  for (const row of open) {
    if (row.mark === null) counts.plain += 1;
    else counts[row.mark] += 1;
  }
  const items = open
    .filter((row): row is typeof row & { mark: TodayPlanMark } => row.mark !== null)
    .slice(0, PLAN_LIMIT)
    .map(({ task, mark }) => ({
      id: task.id,
      title: task.title,
      mark,
      when: planWhen(task, timeZone),
    }));
  return {
    items,
    rest: Math.max(0, open.length - items.length),
    titles: open.map(({ task }) => task.title),
    counts,
  };
}

/** A note that only restates task titles adds nothing next to the plan. */
export function noteRepeatsTasks(note: string, titles: readonly string[]): boolean {
  const hits = titles.filter((title) => title.trim().length >= 2 && note.includes(title.trim()));
  if (hits.length === 0) return false;
  let rest = note;
  for (const title of hits) rest = rest.split(title).join('');
  const filler = rest.replace(/[今天要做有件待办：:，,。.\s先把和与、]/gu, '');
  return filler.length < 8;
}

/** Upcoming window is today through seven days ahead. This drops today. */
export function upcomingExcludingToday<T extends BriefingTask>(
  tasks: readonly T[],
  todayYmd: string,
  timeZone: string,
): T[] {
  const last = addDaysYmd(todayYmd, 7);
  const kept = tasks.filter((task) => {
    if (task.deletedAt) return false;
    if (task.status === 'done' || task.status === 'canceled') return false;
    const anchor = task.dueAt ?? task.startAt;
    if (anchor === null) return false;
    const ymd = ymdInTimeZone(anchor, timeZone);
    return ymd > todayYmd && ymd <= last;
  });
  kept.sort((a, b) => {
    const aIso = a.dueAt ?? a.startAt ?? '';
    const bIso = b.dueAt ?? b.startAt ?? '';
    const byDate = ymdInTimeZone(aIso, timeZone).localeCompare(ymdInTimeZone(bIso, timeZone));
    if (byDate !== 0) return byDate;
    return a.title.localeCompare(b.title, 'zh');
  });
  return kept;
}

export type AgendaItem = {
  id: string;
  title: string;
  /** Local YYYY-MM-DD of the task anchor. */
  ymd: string;
  /** Local HH:mm. Null for an all-day task or a midnight placeholder. */
  clock: string | null;
};

export type AgendaLine = {
  key: string;
  title: string;
  clock: string | null;
  count: number;
};

export type AgendaDay = {
  ymd: string;
  lines: AgendaLine[];
  /** Further distinct slots on this day, after `lines`. */
  hidden: number;
};

/** How many distinct slots a day shows before the rest fold into a count. */
export const AGENDA_DAY_LIMIT = 4;

/** Upcoming tasks as agenda rows. Today is omitted; the calendar module owns that day. */
export function agendaItemsFromTasks(
  tasks: readonly BriefingTask[],
  todayYmd: string,
  timeZone: string,
): AgendaItem[] {
  return upcomingExcludingToday(tasks, todayYmd, timeZone).map((task) => {
    const anchor = task.dueAt ?? task.startAt ?? '';
    const ymd = ymdInTimeZone(anchor, timeZone);
    let clock: string | null = null;
    if (task.isAllDay !== true && anchor !== '') {
      const hm = localHm(anchor, timeZone);
      clock = hm === '00:00' ? null : hm;
    }
    return { id: task.id, title: task.title, ymd, clock };
  });
}

/**
 * Group later days, collapse the same title at the same clock, and keep each
 * day to a short list. An empty today must not sit beside this list.
 */
export function foldAgendaDays(items: readonly AgendaItem[], perDay = AGENDA_DAY_LIMIT): AgendaDay[] {
  const byDay = new Map<string, AgendaItem[]>();
  for (const item of items) {
    const list = byDay.get(item.ymd);
    if (list) list.push(item);
    else byDay.set(item.ymd, [item]);
  }
  const cap = Math.max(0, perDay);
  const days: AgendaDay[] = [];
  for (const ymd of [...byDay.keys()].sort()) {
    const bucket = [...(byDay.get(ymd) ?? [])].sort((a, b) => {
      const ac = a.clock ?? '';
      const bc = b.clock ?? '';
      if (ac !== bc) return ac < bc ? -1 : 1;
      const byTitle = a.title.localeCompare(b.title, 'zh');
      if (byTitle !== 0) return byTitle;
      return a.id.localeCompare(b.id);
    });
    const lines: AgendaLine[] = [];
    for (const item of bucket) {
      const key = `${item.title}\u0000${item.clock ?? ''}`;
      const last = lines[lines.length - 1];
      if (last && last.key === key) {
        last.count += 1;
        continue;
      }
      lines.push({ key, title: item.title, clock: item.clock, count: 1 });
    }
    days.push({ ymd, lines: lines.slice(0, cap), hidden: Math.max(0, lines.length - cap) });
  }
  return days;
}

const WIDE_TODAY_MODULES = new Set(['lead', 'note', 'focus']);
const AGENDA_TODAY_MODULES = new Set(['meetings', 'upcoming']);

/**
 * lead, note, and focus take a row. meetings and upcoming share one agenda row,
 * including on a single column, so an empty today does not stretch beside later days.
 * Weather and holiday pair only with each other when two columns are open.
 */
export function groupTodayModuleRows<T extends { id: string }>(
  modules: readonly T[],
  columns: 1 | 2,
): T[][] {
  const rows: T[][] = [];
  let pending: T | null = null;
  const flush = () => {
    if (!pending) return;
    rows.push([pending]);
    pending = null;
  };
  for (const module of modules) {
    if (AGENDA_TODAY_MODULES.has(module.id)) {
      flush();
      const last = rows[rows.length - 1];
      if (
        last &&
        last.every((item) => AGENDA_TODAY_MODULES.has(item.id)) &&
        !last.some((item) => item.id === module.id)
      ) {
        last.push(module);
      } else {
        rows.push([module]);
      }
      continue;
    }
    if (columns === 1 || WIDE_TODAY_MODULES.has(module.id)) {
      flush();
      rows.push([module]);
      continue;
    }
    if (pending) {
      rows.push([pending, module]);
      pending = null;
    } else {
      pending = module;
    }
  }
  flush();
  return rows;
}

export type NormalizedCalendarEvent = {
  title: string;
  /** Local HH:mm, or YYYY-MM-DD when all-day. */
  start: string;
  allDay: boolean;
};

export function normalizeCalendarEvent(
  payload: unknown,
  timeZone: string,
): NormalizedCalendarEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = payload as { title?: unknown; start?: unknown; allDay?: unknown; all_day?: unknown };
  if (typeof raw.title !== 'string') return null;
  const title = raw.title.trim();
  if (title === '') return null;
  if (typeof raw.start !== 'string' || raw.start.trim() === '') return null;
  const allDay = raw.allDay === true || raw.all_day === true;
  const startRaw = raw.start.trim();
  if (allDay) {
    const date = startRaw.length >= 10 ? startRaw.slice(0, 10) : startRaw;
    return { title, start: date, allDay: true };
  }
  const parsed = new Date(startRaw);
  if (Number.isNaN(parsed.getTime())) return null;
  return { title, start: localHm(startRaw, timeZone), allDay: false };
}
