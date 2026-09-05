import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';
import type { StorageMetadata } from '../../storage/base.adapter.js';
import { users } from './users.js';

export const attachments = pgTable(
  'attachments',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ownerType: varchar('owner_type', { length: 16 }).notNull().default('tmp'),
    ownerId: char('owner_id', { length: 36 }),
    s3Key: varchar('s3_key', { length: 512 }).notNull(),
    mime: varchar('mime', { length: 100 }).notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    status: varchar('status', { length: 16 }).notNull().default('uploading'),
    storageMeta: jsonb('storage_meta').$type<StorageMetadata>().notNull(),
    uploadId: varchar('upload_id', { length: 128 }),
    sortOrder: integer('sort_order').notNull().default(0),
    orphanedAt: timestamp('orphaned_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_attachments_user').on(t.userId),
    index('idx_attachments_owner').on(t.ownerType, t.ownerId),
    check(
      'attachments_owner_type_check',
      sql`${t.ownerType} IN ('tmp', 'task', 'inbox', 'report')`,
    ),
    check('attachments_status_check', sql`${t.status} IN ('uploading', 'ready', 'orphaned')`),
  ],
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
