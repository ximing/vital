import { sql } from 'drizzle-orm';
import { char, check, index, pgTable, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const entityLinks = pgTable(
  'entity_links',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fromType: varchar('from_type', { length: 16 }).notNull(),
    fromId: char('from_id', { length: 36 }).notNull(),
    toType: varchar('to_type', { length: 16 }).notNull(),
    toId: char('to_id', { length: 36 }).notNull(),
    role: varchar('role', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('entity_links_pair_role_uidx').on(t.fromType, t.fromId, t.toType, t.toId, t.role),
    index('idx_entity_links_to').on(t.toType, t.toId),
    index('idx_entity_links_from').on(t.fromType, t.fromId),
    check('entity_links_from_type_check', sql`${t.fromType} IN ('task', 'inbox', 'report')`),
    check('entity_links_to_type_check', sql`${t.toType} IN ('task', 'inbox', 'report')`),
    check(
      'entity_links_role_check',
      sql`${t.role} IN ('embeds', 'converted_from', 'mentioned')`,
    ),
  ],
);

export type EntityLinkRow = typeof entityLinks.$inferSelect;
export type NewEntityLink = typeof entityLinks.$inferInsert;
