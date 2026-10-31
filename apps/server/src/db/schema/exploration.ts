import { sql } from 'drizzle-orm';
import {
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  ExplorationFactStatus,
  ExplorationProposalContent,
  ExplorationProposalStatus,
  ExplorationWindowStatus,
} from '@vital/dto';

/** Consecutive free-day windows. Identity is (user_id, window_key); calendar bumps do not reopen rest/closed. */
export const explorationWindows = pgTable(
  'exploration_windows',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    windowKey: varchar('window_key', { length: 128 }).notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    /** Copied from user settings. Never filled from holiday_calendar.region default. */
    region: varchar('region', { length: 8 }),
    calendarVersion: varchar('calendar_version', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 })
      .notNull()
      .default('open')
      .$type<ExplorationWindowStatus>(),
    closedReason: varchar('closed_reason', { length: 64 }),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('exploration_windows_user_key_uidx').on(t.userId, t.windowKey),
    index('idx_exploration_windows_user_dates').on(t.userId, t.startDate, t.endDate),
    check('exploration_windows_status_check', sql`${t.status} IN ('open', 'closed', 'rest')`),
  ],
);

export const explorationProposals = pgTable(
  'exploration_proposals',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    windowId: char('window_id', { length: 36 }).notNull(),
    activityKey: varchar('activity_key', { length: 128 }).notNull(),
    status: varchar('status', { length: 32 })
      .notNull()
      .default('proposed')
      .$type<ExplorationProposalStatus>(),
    interestReason: text('interest_reason'),
    content: jsonb('content').$type<ExplorationProposalContent>().notNull().default({} as ExplorationProposalContent),
    planId: char('plan_id', { length: 36 }),
    taskId: char('task_id', { length: 36 }),
    place: varchar('place', { length: 128 }),
    decisionDeadline: timestamp('decision_deadline', { withTimezone: true, mode: 'date' }),
    departureAt: timestamp('departure_at', { withTimezone: true, mode: 'date' }),
    nextVerifyAt: timestamp('next_verify_at', { withTimezone: true, mode: 'date' }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true, mode: 'date' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true, mode: 'date' }),
    version: integer('version').notNull().default(1),
    idempotencyKey: varchar('idempotency_key', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('exploration_proposals_window_activity_uidx').on(t.windowId, t.activityKey),
    uniqueIndex('exploration_proposals_idempotency_uidx')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('idx_exploration_proposals_user_window').on(t.userId, t.windowId),
    index('idx_exploration_proposals_user_rejected').on(t.userId, t.activityKey, t.place, t.rejectedAt),
    index('idx_exploration_proposals_next_verify').on(t.userId, t.nextVerifyAt),
    check(
      'exploration_proposals_status_check',
      sql`${t.status} IN ('proposed', 'selected', 'verification_pending', 'draft_ready', 'confirmed', 'completed', 'canceled')`,
    ),
  ],
);

export const explorationVerifications = pgTable(
  'exploration_verifications',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    proposalId: char('proposal_id', { length: 36 }).notNull(),
    stage: varchar('stage', { length: 32 }).notNull().default('initial'),
    field: varchar('field', { length: 64 }).notNull().default(''),
    value: jsonb('value').$type<unknown>(),
    url: text('url'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }),
    validUntil: timestamp('valid_until', { withTimezone: true, mode: 'date' }),
    status: varchar('status', { length: 16 })
      .notNull()
      .default('unknown')
      .$type<ExplorationFactStatus>(),
    diff: jsonb('diff').$type<unknown>(),
    fingerprint: varchar('fingerprint', { length: 32 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_exploration_verifications_user_proposal').on(t.userId, t.proposalId),
    check(
      'exploration_verifications_status_check',
      sql`${t.status} IN ('verified', 'unknown', 'changed')`,
    ),
  ],
);

export type ExplorationWindowRow = typeof explorationWindows.$inferSelect;
export type ExplorationProposalRow = typeof explorationProposals.$inferSelect;
export type ExplorationVerificationRow = typeof explorationVerifications.$inferSelect;
