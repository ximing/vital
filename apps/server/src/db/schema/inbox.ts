import { type SQL, sql } from 'drizzle-orm';
import type { ArticleDoc } from '@vital/article-doc';
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
    userId: char('user_id', { length: 36 }).notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    /** Owning thread when filed as material. Ownership checked in the service layer. */
    outcomeId: char('outcome_id', { length: 36 }),
    originalUrl: text('original_url'),
    canonicalUrl: text('canonical_url'),
    excerpt: varchar('excerpt', { length: 500 }),
    byline: varchar('byline', { length: 200 }),
    siteName: varchar('site_name', { length: 200 }),
    status: varchar('status', { length: 16 }).notNull().default('unread'),
    source: varchar('source', { length: 16 }).notNull().default('manual'),
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    idempotencyKey: char('idempotency_key', { length: 64 }),
    convertedTaskId: char('converted_task_id', { length: 36 }),
    /** inwit document created by 转存 (null = not exported). */
    inwitDocumentId: char('inwit_document_id', { length: 36 }),
    inwitExportedAt: timestamp('inwit_exported_at', { withTimezone: true, mode: 'date' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    searchTsv: tsvector('search_tsv')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('simple', coalesce(${inboxItems.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${inboxItems.excerpt}, '')), 'B')`,
      ),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('inbox_items_user_idempotency_uidx')
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index('idx_inbox_items_user_captured').on(t.userId, t.capturedAt),
    index('idx_inbox_items_user_updated').on(t.userId, t.updatedAt),
    index('idx_inbox_items_user_status_captured').on(t.userId, t.status, t.capturedAt),
    index('idx_inbox_items_user_outcome').on(t.userId, t.outcomeId),
    index('idx_inbox_items_live_captured')
      .on(t.userId, t.capturedAt)
      .where(sql`${t.deletedAt} IS NULL`),
    index('idx_inbox_items_search_tsv').using('gin', t.searchTsv),
    index('idx_inbox_items_title_trgm').using('gin', sql`${t.title} gin_trgm_ops`),
    check(
      'inbox_items_status_check',
      sql`${t.status} IN ('unread', 'later', 'archived', 'converted')`,
    ),
    check(
      'inbox_items_source_check',
      sql`${t.source} IN ('extension', 'wechat', 'web', 'mobile', 'manual')`,
    ),
  ],
);

export const inboxItemBodies = pgTable('inbox_item_bodies', {
  inboxItemId: char('inbox_item_id', { length: 36 }).primaryKey(),
  extractedText: text('extracted_text'),
  /** Article body (article-doc JSON) — the only body format. */
  contentJson: jsonb('content_json').$type<ArticleDoc>(),
});

/** Replay snapshot for POST /inbox. Loaded only on idempotent replay, never on list/sync. */
export const inboxIdempotencyResponses = pgTable('inbox_idempotency_responses', {
  inboxItemId: char('inbox_item_id', { length: 36 }).primaryKey(),
  response: jsonb('response').$type<InboxIdempotencyResponse>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const inboxAssets = pgTable(
  'inbox_assets',
  {
    id: char('id', { length: 36 }).primaryKey(),
    inboxItemId: char('inbox_item_id', { length: 36 }).notNull(),
    attachmentId: char('attachment_id', { length: 36 }).notNull(),
    originalSrc: text('original_src').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    unique('inbox_assets_item_attachment_uidx').on(t.inboxItemId, t.attachmentId),
    index('idx_inbox_assets_item').on(t.inboxItemId),
  ],
);

export type InboxItemRow = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;
export type InboxItemBodyRow = typeof inboxItemBodies.$inferSelect;
export type InboxIdempotencyResponseRow = typeof inboxIdempotencyResponses.$inferSelect;
export type InboxAssetRow = typeof inboxAssets.$inferSelect;
export type NewInboxAsset = typeof inboxAssets.$inferInsert;
