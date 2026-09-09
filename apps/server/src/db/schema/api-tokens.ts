import { bigserial, char, index, pgTable, smallint, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 50 }).notNull(),
    tokenPrefix: varchar('token_prefix', { length: 16 }).notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_api_tokens_user').on(t.userId)],
);

export type ApiTokenRow = typeof apiTokens.$inferSelect;

export const apiTokenAccessLogs = pgTable(
  'api_token_access_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tokenId: char('token_id', { length: 36 })
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    method: varchar('method', { length: 8 }).notNull(),
    path: varchar('path', { length: 512 }).notNull(),
    status: smallint('status').notNull(),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_api_token_access_logs_token_created').on(t.tokenId, t.createdAt),
    index('idx_api_token_access_logs_created').on(t.createdAt),
  ],
);

export type ApiTokenAccessLogRow = typeof apiTokenAccessLogs.$inferSelect;
