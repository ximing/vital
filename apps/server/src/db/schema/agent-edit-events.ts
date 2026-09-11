import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** One tracked field change inside a single edit event. */
export interface AgentEditFieldChange {
  field: string;
  /** Summary values only — titles truncated, instants as ISO strings. */
  before: unknown;
  after: unknown;
}

/**
 * One row per user edit of a task/outcome through the normal update APIs.
 * Agent write paths never produce these rows; memory.distill consumes them
 * as correction signals and records consumption in agent_edit_feedback.
 */
export const agentEditEvents = pgTable(
  'agent_edit_events',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 16 }).notNull(),
    entityId: char('entity_id', { length: 36 }).notNull(),
    fields: jsonb('fields').$type<AgentEditFieldChange[]>().notNull(),
    /** Reserved for future non-user origins; always 'user' for now. */
    source: varchar('source', { length: 16 }).notNull().default('user'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_agent_edit_events_user_created').on(t.userId, t.createdAt),
    check('agent_edit_events_entity_type_check', sql`${t.entityType} IN ('task', 'outcome')`),
    check('agent_edit_events_source_check', sql`${t.source} IN ('user', 'agent')`),
  ],
);

/** Distill consumption marker — edit rows are immutable, no fingerprint needed. */
export const agentEditFeedback = pgTable(
  'agent_edit_feedback',
  {
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventId: char('event_id', { length: 36 }).notNull(),
    jobId: char('job_id', { length: 36 }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] })],
);

export type AgentEditEventRow = typeof agentEditEvents.$inferSelect;
export type NewAgentEditEvent = typeof agentEditEvents.$inferInsert;
