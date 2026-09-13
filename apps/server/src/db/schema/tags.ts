import { sql } from 'drizzle-orm';
import { char, index, pgTable, primaryKey, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

export const tags = pgTable(
  'tags',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 40 }).notNull(),
    color: varchar('color', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tags_user_lower_name_uidx').on(t.userId, sql`lower(${t.name})`)],
);

export const taskTags = pgTable(
  'task_tags',
  {
    taskId: char('task_id', { length: 36 }).notNull(),
    tagId: char('tag_id', { length: 36 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.tagId] }),
    index('idx_task_tags_tag').on(t.tagId),
  ],
);

export const inboxItemTags = pgTable(
  'inbox_item_tags',
  {
    inboxItemId: char('inbox_item_id', { length: 36 }).notNull(),
    tagId: char('tag_id', { length: 36 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.inboxItemId, t.tagId] }),
    index('idx_inbox_item_tags_tag').on(t.tagId),
  ],
);

export type TagRow = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type TaskTagRow = typeof taskTags.$inferSelect;
export type InboxItemTagRow = typeof inboxItemTags.$inferSelect;
