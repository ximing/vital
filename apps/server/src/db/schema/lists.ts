import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const lists = pgTable(
  'lists',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('user'),
    name: varchar('name', { length: 80 }).notNull(),
    color: varchar('color', { length: 16 }),
    icon: varchar('icon', { length: 32 }),
    iconAttachmentId: char('icon_attachment_id', { length: 36 }),
    parentId: char('parent_id', { length: 36 }),
    sortOrder: integer('sort_order').notNull().default(0),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lists_user_inbox_uidx')
      .on(t.userId)
      .where(sql`${t.kind} = 'inbox'`),
    index('idx_lists_user_sort').on(t.userId, t.sortOrder),
    index('idx_lists_user_parent_sort').on(t.userId, t.parentId, t.sortOrder),
    check('lists_kind_check', sql`${t.kind} IN ('user', 'inbox')`),
  ],
);

export type ListRow = typeof lists.$inferSelect;
export type NewList = typeof lists.$inferInsert;
