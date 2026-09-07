import { check, date, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const holidayCalendar = pgTable(
  'holiday_calendar',
  {
    region: varchar('region', { length: 8 }).notNull().default('CN'),
    date: date('date', { mode: 'string' }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    sourceVersion: varchar('source_version', { length: 32 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.region, t.date] }),
    check('holiday_calendar_kind_check', sql`${t.kind} IN ('holiday', 'workday')`),
  ],
);
