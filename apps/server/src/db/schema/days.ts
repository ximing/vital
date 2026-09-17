import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type { CoverPreset, DayReminderOffset } from '@vital/dto';

export const days = pgTable(
  'days',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    note: varchar('note', { length: 200 }).notNull().default(''),
    source: varchar('source', { length: 16 }).notNull(),
    catalogKey: varchar('catalog_key', { length: 64 }),
    calendar: varchar('calendar', { length: 8 }).notNull(),
    repeat: varchar('repeat', { length: 8 }).notNull().default('none'),
    displayMode: varchar('display_mode', { length: 16 }).notNull().default('auto'),
    anchorYmd: date('anchor_ymd', { mode: 'string' }).notNull(),
    lunarMonth: smallint('lunar_month'),
    lunarDay: smallint('lunar_day'),
    lunarLeap: boolean('lunar_leap').notNull().default(false),
    timeHm: varchar('time_hm', { length: 5 }),
    coverPreset: varchar('cover_preset', { length: 32 }).notNull().default('mist').$type<CoverPreset>(),
    coverAttachmentId: char('cover_attachment_id', { length: 36 }),
    reminderOffsets: jsonb('reminder_offsets').$type<DayReminderOffset[]>().notNull().default([]),
    pinned: boolean('pinned').notNull().default(false),
    pinOrder: integer('pin_order').notNull().default(0),
    hidden: boolean('hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_days_user_hidden').on(t.userId, t.hidden),
    uniqueIndex('days_user_catalog_uidx')
      .on(t.userId, t.catalogKey)
      .where(sql`${t.catalogKey} IS NOT NULL`),
    check('days_source_check', sql`${t.source} IN ('custom', 'statutory', 'catalog')`),
    check('days_calendar_check', sql`${t.calendar} IN ('solar', 'lunar')`),
    check('days_repeat_check', sql`${t.repeat} IN ('none', 'yearly')`),
    check('days_display_mode_check', sql`${t.displayMode} IN ('auto', 'countdown', 'countup')`),
    check(
      'days_lunar_check',
      sql`(${t.calendar} = 'solar' AND ${t.lunarMonth} IS NULL AND ${t.lunarDay} IS NULL) OR (${t.calendar} = 'lunar' AND ${t.lunarMonth} BETWEEN 1 AND 12 AND ${t.lunarDay} BETWEEN 1 AND 30)`,
    ),
  ],
);

export type DayRow = typeof days.$inferSelect;
export type NewDay = typeof days.$inferInsert;
