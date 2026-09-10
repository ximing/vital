import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Where a memory row may be injected. 'all' hits every capability; the other
 * values are agent capabilities that consume memory in their prompts.
 */
export const AGENT_MEMORY_SCOPES = [
  'all',
  'headline',
  'cluster',
  'decompose',
  'draft',
  'reflect',
  'distill',
  'notify',
] as const;
export type AgentMemoryScope = (typeof AGENT_MEMORY_SCOPES)[number];

/** Discriminated per job_type. */
export type AgentJobPayload =
  | { outcomeId: string }
  | { taskId: string }
  | { date: string };

export const agentJobs = pgTable(
  'agent_jobs',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobType: varchar('job_type', { length: 32 }).notNull(),
    payload: jsonb('payload').$type<AgentJobPayload>().notNull(),
    /** Unique; upsert on conflict re-arms scheduledAt (collapses mutation bursts). */
    dedupKey: varchar('dedup_key', { length: 180 }).notNull().unique(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_agent_jobs_due').on(t.status, t.scheduledAt),
    index('idx_agent_jobs_user_type').on(t.userId, t.jobType),
    check(
      'agent_jobs_type_check',
      sql`${t.jobType} IN ('outcome.refresh', 'outcome.cluster', 'task.decompose', 'task.draft', 'reflect.daily', 'memory.distill', 'habit.spawn', 'notify.scan')`,
    ),
    check(
      'agent_jobs_status_check',
      sql`${t.status} IN ('pending', 'running', 'done', 'failed', 'cancelled')`,
    ),
  ],
);

export const agentActions = pgTable(
  'agent_actions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: char('job_id', { length: 36 }).references(() => agentJobs.id, { onDelete: 'set null' }),
    actionType: varchar('action_type', { length: 32 }).notNull(),
    targetType: varchar('target_type', { length: 16 }).notNull(),
    /** Plain column, no FK — the target may be undone or deleted. */
    targetId: char('target_id', { length: 36 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    feedback: varchar('feedback', { length: 16 }).notNull().default('pending'),
    feedbackPayload: jsonb('feedback_payload').$type<Record<string, unknown>>(),
    feedbackAt: timestamp('feedback_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_agent_actions_user_feedback').on(t.userId, t.feedback),
    index('idx_agent_actions_target').on(t.targetType, t.targetId, t.feedback),
    check(
      'agent_actions_type_check',
      sql`${t.actionType} IN ('outcome.create', 'outcome.headline', 'outcome.suggestion', 'task.decompose', 'task.draft', 'habit.create', 'habit.adjust', 'habit.nudge')`,
    ),
    check(
      'agent_actions_target_type_check',
      sql`${t.targetType} IN ('outcome', 'task', 'habit')`,
    ),
    check(
      'agent_actions_feedback_check',
      sql`${t.feedback} IN ('pending', 'accepted', 'edited', 'dismissed')`,
    ),
  ],
);

export const agentMemory = pgTable(
  'agent_memory',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).notNull(),
    content: text('content').notNull(),
    sourceCount: integer('source_count').notNull().default(1),
    /** User-written rows are protected: distill may never update or drop them. */
    manual: boolean('manual').notNull().default(false),
    /** Injection filter: capabilities this row may be injected into. */
    scope: text('scope').array().notNull().default(sql`'{all}'`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_agent_memory_user_kind').on(t.userId, t.kind),
    check('agent_memory_kind_check', sql`${t.kind} IN ('preference', 'pattern', 'correction')`),
    check(
      'agent_memory_scope_check',
      sql`${t.scope} <> '{}' AND ${t.scope} <@ ARRAY['all', 'headline', 'cluster', 'decompose', 'draft', 'reflect', 'distill', 'notify']::text[]`,
    ),
  ],
);

export const agentUsage = pgTable(
  'agent_usage',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: char('job_id', { length: 36 })
      .notNull()
      .references(() => agentJobs.id, { onDelete: 'cascade' }),
    capability: varchar('capability', { length: 24 }).notNull(),
    model: varchar('model', { length: 120 }).notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    /** Micro-USD, computed at write time. 0 when the model's price is unknown. */
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_agent_usage_user_created').on(t.userId, t.createdAt),
    check(
      'agent_usage_capability_check',
      sql`${t.capability} IN ('parse', 'headline', 'suggestion', 'cluster', 'decompose', 'draft', 'reflect', 'distill', 'notify', 'critic')`,
    ),
  ],
);

export type AgentJobRow = typeof agentJobs.$inferSelect;
export type NewAgentJob = typeof agentJobs.$inferInsert;
export type AgentActionRow = typeof agentActions.$inferSelect;
export type NewAgentAction = typeof agentActions.$inferInsert;
export type AgentMemoryRow = typeof agentMemory.$inferSelect;
export type NewAgentMemory = typeof agentMemory.$inferInsert;
export type AgentUsageRow = typeof agentUsage.$inferSelect;
export type NewAgentUsage = typeof agentUsage.$inferInsert;
