import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  integer,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  DEFAULT_DAILY_MODEL_CALL_LIMIT,
  MAX_DAILY_MODEL_CALL_LIMIT,
  MIN_DAILY_MODEL_CALL_LIMIT,
  type OnboardingState,
} from '@vital/dto';

export const users = pgTable(
  'users',
  {
    id: char('id', { length: 36 }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 50 }).notNull(),
    avatarAttachmentId: char('avatar_attachment_id', { length: 36 }),
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Shanghai'),
    locale: varchar('locale', { length: 16 }).notNull().default('zh-CN'),
    themePreference: varchar('theme_preference', { length: 16 }).notNull().default('system'),
    weekStartsOn: smallint('week_starts_on').notNull().default(1),
    dailyModelCallLimit: integer('daily_model_call_limit')
      .notNull()
      .default(DEFAULT_DAILY_MODEL_CALL_LIMIT),
    convertArchiveOnComplete: boolean('convert_archive_on_complete').notNull().default(false),
    notifyTaskRemind: boolean('notify_task_remind').notNull().default(true),
    notifyTaskDue: boolean('notify_task_due').notNull().default(true),
    notifyAgentInsights: boolean('notify_agent_insights').notNull().default(true),
    notifyDayRemind: boolean('notify_day_remind').notNull().default(true),
    notifyMorningBrief: boolean('notify_morning_brief').notNull().default(true),
    notifyMeetingPrep: boolean('notify_meeting_prep').notNull().default(true),
    notifyWeeklyObserve: boolean('notify_weekly_observe').notNull().default(true),
    notifyAgentErrand: boolean('notify_agent_errand').notNull().default(true),
    /** Chat may propose a time-box plan. Off means no schedule card. */
    scheduleSuggest: boolean('schedule_suggest').notNull().default(true),
    workHoursStart: varchar('work_hours_start', { length: 5 }).notNull().default('09:00'),
    workHoursEnd: varchar('work_hours_end', { length: 5 }).notNull().default('18:00'),
    /** Minutes of agent time-boxes allowed on one local day. */
    scheduleDayCapMinutes: integer('schedule_day_cap_minutes').notNull().default(540),
    quietHoursStart: varchar('quiet_hours_start', { length: 5 }),
    quietHoursEnd: varchar('quiet_hours_end', { length: 5 }),
    allDayNotifyTime: varchar('all_day_notify_time', { length: 5 }).notNull().default('09:00'),
    morningBriefTime: varchar('morning_brief_time', { length: 5 }).notNull().default('07:30'),
    onboarding: jsonb('onboarding').$type<OnboardingState>().notNull().default({}),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check('users_theme_preference_check', sql`${t.themePreference} IN ('light', 'dark', 'system')`),
    check('users_week_starts_on_check', sql`${t.weekStartsOn} IN (0, 1)`),
    check(
      'users_daily_model_call_limit_check',
      sql`${t.dailyModelCallLimit} BETWEEN ${sql.raw(String(MIN_DAILY_MODEL_CALL_LIMIT))} AND ${sql.raw(String(MAX_DAILY_MODEL_CALL_LIMIT))}`,
    ),
    check(
      'users_quiet_hours_pair_check',
      sql`(${t.quietHoursStart} IS NULL AND ${t.quietHoursEnd} IS NULL) OR (${t.quietHoursStart} IS NOT NULL AND ${t.quietHoursEnd} IS NOT NULL)`,
    ),
    check(
      'users_work_hours_check',
      sql`${t.workHoursStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.workHoursEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.workHoursEnd} > ${t.workHoursStart}`,
    ),
    check('users_schedule_day_cap_check', sql`${t.scheduleDayCapMinutes} BETWEEN 30 AND 1440`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
