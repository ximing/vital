import { char, jsonb, pgTable, timestamp } from 'drizzle-orm/pg-core';

/** Per-user Today composition. No foreign key — the service checks the user. */
export const todayLayouts = pgTable('today_layouts', {
  userId: char('user_id', { length: 36 }).primaryKey(),
  modules: jsonb('modules').$type<{ id: string; text?: string }[]>().notNull().default([]),
  context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
