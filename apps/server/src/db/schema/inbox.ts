import { type SQL, sql } from 'drizzle-orm';
import {
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tasks } from './tasks.js';
import { attachments } from './attachments.js';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export interface InboxIdempotencyResponse {
  status: number;
  body: unknown;
}

export const inboxItems = pgTable(
  'inbox_items',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 500 }).notNull(),
    originalUrl: text('original_url'),
    canonicalUrl: text('canonical_url'),
    extractedText: text('extracted_text'),
    extractedHtml: text('extracted_html'),
    excerpt: varchar('excerpt', { length: 500 }),
    byline: varchar('byline', { length: 200 }),
    siteName: varchar('site_name', { length: 200 }),
    status: varchar('status', { length: 16 }).notNull().default('unread'),
    source: varchar('source', { length: 16 }).notNull().default('manual'),
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    idempotencyKey: char('idempotency_key', { length: 64 }),
    idempotencyResponse: jsonb('idempotency_response').$type<InboxIdempotencyResponse>(),
    convertedTaskId: char('converted_task_id', { length: 36 }).references(() => tasks.id, {
      onDelete: 'set null',
    }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    searchTsv: tsvector('search_tsv')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('simple', coalesce(${inboxItems.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${inboxItems.excerpt}, '')), 'B') || setweight(to_tsvector('simple', coalesce(${inboxItems.extractedText}, '')), 'C')`,
      ),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('inbox_items_user_idempotency_uidx')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index('idx_inbox_items_user_captured').on(t.userId, t.capturedAt),
    index('idx_inbox_items_user_updated').on(t.userId, t.updatedAt),
    index('idx_inbox_items_search_tsv').using('gin', t.searchTsv),
    index('idx_inbox_items_title_trgm').using('gin', sql`${t.title} gin_trgm_ops`),
    check(
      'inbox_items_status_check',
      sql`${t.status} IN ('unread', 'later', 'archived', 'converted')`,
    ),
    check(
      'inbox_items_source_check',
      sql`${t.source} IN ('extension', 'web', 'mobile', 'manual')`,
    ),
  ],
);

export const inboxAssets = pgTable(
  'inbox_assets',
  {
    id: char('id', { length: 36 }).primaryKey(),
    inboxItemId: char('inbox_item_id', { length: 36 })
      .notNull()
      .references(() => inboxItems.id, { onDelete: 'cascade' }),
    attachmentId: char('attachment_id', { length: 36 })
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    originalSrc: text('original_src').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [unique('inbox_assets_item_attachment_uidx').on(t.inboxItemId, t.attachmentId)],
);

export type InboxItemRow = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;
export type InboxAssetRow = typeof inboxAssets.$inferSelect;
export type NewInboxAsset = typeof inboxAssets.$inferInsert;
