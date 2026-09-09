import { type SQL, sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const habits = pgTable(
  'habits',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    kind: varchar('kind', { length: 8 }).notNull(),
    /** Required when kind = 'count' (e.g. 8 glasses of water a day). */
    targetCount: integer('target_count'),
    /** 'HH:mm' local-time window; outside it no instances spawn. */
    windowStart: varchar('window_start', { length: 5 }),
    windowEnd: varchar('window_end', { length: 5 }),
    active: boolean('active').notNull().default(true),
    createdBy: varchar('created_by', { length: 8 }).notNull().default('user'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_habits_user_active').on(t.userId, t.active),
    check('habits_kind_check', sql`${t.kind} IN ('daily', 'count')`),
    check('habits_created_by_check', sql`${t.createdBy} IN ('user', 'agent')`),
    check(
      'habits_target_count_check',
      sql`(${t.kind} = 'count' AND ${t.targetCount} IS NOT NULL AND ${t.targetCount} BETWEEN 1 AND 99) OR (${t.kind} = 'daily' AND ${t.targetCount} IS NULL)`,
    ),
  ],
);

export type HabitRow = typeof habits.$inferSelect;
export type NewHabit = typeof habits.$inferInsert;
