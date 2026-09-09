import { type SQL, sql } from 'drizzle-orm';
import { char, check, index, integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const outcomes = pgTable(
  'outcomes',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    status: varchar('status', { length: 8 }).notNull().default('open'),
    createdBy: varchar('created_by', { length: 8 }).notNull().default('user'),
    ruleSignal: varchar('rule_signal', { length: 8 }),
    ruleNextStep: text('rule_next_step'),
    ruleUpdatedAt: timestamp('rule_updated_at', { withTimezone: true, mode: 'date' }),
    agentHeadline: text('agent_headline'),
    agentSuggestion: text('agent_suggestion'),
    agentState: varchar('agent_state', { length: 16 }).notNull().default('idle'),
    agentUpdatedAt: timestamp('agent_updated_at', { withTimezone: true, mode: 'date' }),
    /** Set (= createdAt + undo window) only when createdBy = 'agent'. */
    undoUntil: timestamp('undo_until', { withTimezone: true, mode: 'date' }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true, mode: 'date' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_outcomes_user_status').on(t.userId, t.status),
    index('idx_outcomes_user_sort').on(t.userId, t.sortOrder),
    check('outcomes_status_check', sql`${t.status} IN ('open', 'closed')`),
    check('outcomes_created_by_check', sql`${t.createdBy} IN ('user', 'agent')`),
    check(
      'outcomes_rule_signal_check',
      sql`${t.ruleSignal} IS NULL OR ${t.ruleSignal} IN ('up', 'flat', 'alert')`,
    ),
    check(
      'outcomes_agent_state_check',
      sql`${t.agentState} IN ('idle', 'pending', 'failed')`,
    ),
  ],
);

export type OutcomeRow = typeof outcomes.$inferSelect;
export type NewOutcome = typeof outcomes.$inferInsert;
