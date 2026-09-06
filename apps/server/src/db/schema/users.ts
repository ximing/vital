import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import type { OnboardingState } from '@vital/dto';

export const users = pgTable(
  'users',
  {
    id: char('id', { length: 36 }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 50 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Shanghai'),
    locale: varchar('locale', { length: 16 }).notNull().default('zh-CN'),
    themePreference: varchar('theme_preference', { length: 16 }).notNull().default('system'),
    weekStartsOn: smallint('week_starts_on').notNull().default(1),
    convertArchiveOnComplete: boolean('convert_archive_on_complete').notNull().default(false),
    notifyTaskRemind: boolean('notify_task_remind').notNull().default(true),
    notifyTaskDue: boolean('notify_task_due').notNull().default(true),
    quietHoursStart: varchar('quiet_hours_start', { length: 5 }),
    quietHoursEnd: varchar('quiet_hours_end', { length: 5 }),
    allDayNotifyTime: varchar('all_day_notify_time', { length: 5 }).notNull().default('09:00'),
    onboarding: jsonb('onboarding').$type<OnboardingState>().notNull().default({}),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('users_theme_preference_check', sql`${t.themePreference} IN ('light', 'dark', 'system')`),
    check('users_week_starts_on_check', sql`${t.weekStartsOn} IN (0, 1)`),
    check(
      'users_quiet_hours_pair_check',
      sql`(${t.quietHoursStart} IS NULL AND ${t.quietHoursEnd} IS NULL) OR (${t.quietHoursStart} IS NOT NULL AND ${t.quietHoursEnd} IS NOT NULL)`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
