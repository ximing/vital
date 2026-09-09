import { sql } from 'drizzle-orm';
import { char, pgTable, primaryKey, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tasks } from './tasks.js';
import { inboxItems } from './inbox.js';

export const tags = pgTable(
  'tags',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 40 }).notNull(),
    color: varchar('color', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tags_user_lower_name_uidx').on(t.userId, sql`lower(${t.name})`)],
);

export const taskTags = pgTable(
  'task_tags',
  {
    taskId: char('task_id', { length: 36 })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: char('tag_id', { length: 36 })
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] })],
);

export const inboxItemTags = pgTable(
  'inbox_item_tags',
  {
    inboxItemId: char('inbox_item_id', { length: 36 })
      .notNull()
      .references(() => inboxItems.id, { onDelete: 'cascade' }),
    tagId: char('tag_id', { length: 36 })
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.inboxItemId, t.tagId] })],
);

export type TagRow = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type TaskTagRow = typeof taskTags.$inferSelect;
export type InboxItemTagRow = typeof inboxItemTags.$inferSelect;
