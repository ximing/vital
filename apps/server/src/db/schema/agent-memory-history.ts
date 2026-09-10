import { char, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export interface MemoryFeedbackSource { actionId: string; feedbackAt: string; version: string }
export const agentMemoryFeedback = pgTable('agent_memory_feedback', {
  userId: char('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  actionId: char('action_id', { length: 36 }).notNull(),
  version: text('version').notNull(),
  feedbackAt: timestamp('feedback_at', { withTimezone: true, mode: 'date' }).notNull(),
  jobId: char('job_id', { length: 36 }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.actionId, t.version] })]);

export const agentMemoryHistory = pgTable('agent_memory_history', {
  id: char('id', { length: 36 }).primaryKey(),
  userId: char('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  memoryId: char('memory_id', { length: 36 }).notNull(),
  revision: integer('revision').notNull(),
  operation: text('operation').notNull(),
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),
  sourceFeedback: jsonb('source_feedback').$type<MemoryFeedbackSource[]>().notNull(),
  jobId: char('job_id', { length: 36 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
}, t => [index('idx_agent_memory_history_user_memory').on(t.userId, t.memoryId)]);

export const agentMemoryMaintenance = pgTable('agent_memory_maintenance', {
  userId: char('user_id', { length: 36 }).primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  fingerprint: text('fingerprint').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
});
