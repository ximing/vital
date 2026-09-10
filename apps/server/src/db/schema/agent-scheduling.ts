import { bigint, boolean, char, index, integer, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const agentScheduling = pgTable('agent_scheduling', {
  userId: char('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  capability: varchar('capability', { length: 32 }).notNull(),
  generation: bigint('generation', { mode: 'number' }).notNull().default(0),
  processedGeneration: bigint('processed_generation', { mode: 'number' }).notNull().default(0),
  pendingCount: integer('pending_count').notNull().default(0),
  urgent: boolean('urgent').notNull().default(false),
  pendingSince: timestamp('pending_since', { withTimezone: true, mode: 'date' }),
  dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
  cooldownUntil: timestamp('cooldown_until', { withTimezone: true, mode: 'date' }),
  lastSucceededAt: timestamp('last_succeeded_at', { withTimezone: true, mode: 'date' }),
  observedAt: timestamp('observed_at', { withTimezone: true, mode: 'date' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.capability] }), index('idx_agent_scheduling_due').on(t.dueAt)]);
