import { and, eq, gte, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getDb } from '../db/index.js';
import { holidayCalendar } from '../db/schema.js';

export type ChinaCalendarKind = 'holiday' | 'workday' | null;
export type ChinaCalendarLookup = (date: string) => Promise<ChinaCalendarKind>;

async function databaseLookup(date: string): Promise<ChinaCalendarKind> {
  const [row] = await getDb()
    .select({ kind: holidayCalendar.kind })
    .from(holidayCalendar)
    .where(and(eq(holidayCalendar.region, 'CN'), eq(holidayCalendar.date, date)))
    .limit(1);
  return row?.kind === 'holiday' || row?.kind === 'workday' ? row.kind : null;
}

function weekday(date: string): boolean {
  const day = DateTime.fromISO(date, { zone: 'Asia/Shanghai' });
  return day.isValid && day.weekday >= 1 && day.weekday <= 5;
}

/** One range query for CN holiday/makeup rows; dates outside the window are treated as unset. */
export async function loadChinaCalendarWindow(
  fromDate: string,
  toDate: string,
): Promise<Map<string, ChinaCalendarKind>> {
  if (fromDate > toDate) return new Map();
  const rows = await getDb()
    .select({ date: holidayCalendar.date, kind: holidayCalendar.kind })
    .from(holidayCalendar)
    .where(
      and(
        eq(holidayCalendar.region, 'CN'),
        gte(holidayCalendar.date, fromDate),
        lte(holidayCalendar.date, toDate),
      ),
    );
  const map = new Map<string, ChinaCalendarKind>();
  for (const row of rows) {
    if (row.kind === 'holiday' || row.kind === 'workday') map.set(row.date, row.kind);
  }
  return map;
}

export function chinaCalendarLookupFromWindow(
  map: ReadonlyMap<string, ChinaCalendarKind>,
): ChinaCalendarLookup {
  return (date) => Promise.resolve(map.get(date) ?? null);
}

export async function matchesChinaRule(
  date: string,
  rule: 'holidays' | 'legal_workdays',
  lookup: ChinaCalendarLookup = databaseLookup,
): Promise<boolean> {
  const explicit = await lookup(date);
  if (explicit === 'holiday') return rule === 'holidays';
  if (explicit === 'workday') return rule === 'legal_workdays';
  return rule === 'legal_workdays' && weekday(date);
}
