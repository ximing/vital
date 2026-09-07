import { and, eq } from 'drizzle-orm';
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
