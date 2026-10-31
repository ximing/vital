import { check, date, pgTable, primaryKey, text, timestamp, varchar } from 'drizzle-orm/pg-core';
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

/** Import metadata per region. Missing/stale coverage means do not guess 调休. */
export const holidayCalendarSources = pgTable('holiday_calendar_sources', {
  region: varchar('region', { length: 8 }).primaryKey(),
  sourceUrl: text('source_url').notNull().default(''),
  fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }),
  coverageFrom: date('coverage_from', { mode: 'string' }),
  coverageTo: date('coverage_to', { mode: 'string' }),
  sourceVersion: varchar('source_version', { length: 32 }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type HolidayCalendarSourceRow = typeof holidayCalendarSources.$inferSelect;
