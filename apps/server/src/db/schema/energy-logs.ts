import { sql } from 'drizzle-orm';
import { char, check, index, pgTable, smallint, text, timestamp } from 'drizzle-orm/pg-core';

/** Append-only energy/mood notes. No foreign key; user_id is checked in the service. */
export const energyLogs = pgTable(
  'energy_logs',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    energy: smallint('energy').notNull(),
    mood: text('mood'),
    note: text('note'),
    loggedAt: timestamp('logged_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_energy_logs_user_logged').on(t.userId, t.loggedAt),
    index('idx_energy_logs_user_created').on(t.userId, t.createdAt),
    check('energy_logs_energy_check', sql`${t.energy} BETWEEN 1 AND 5`),
  ],
);

export type EnergyLogRow = typeof energyLogs.$inferSelect;
export type NewEnergyLog = typeof energyLogs.$inferInsert;
