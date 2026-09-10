import { char, date, integer, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/** Durable reservations count attempted background model requests, not tokens. */
export const agentModelBudgets = pgTable('agent_model_budgets', {
  userId: char('user_id', { length: 36 }).notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  requests: integer('requests').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);
