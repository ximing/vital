import { char, index, pgTable, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const extensionAuthCodes = pgTable(
  'extension_auth_codes',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: char('code_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('idx_extension_auth_codes_expires').on(t.expiresAt)],
);

export type ExtensionAuthCode = typeof extensionAuthCodes.$inferSelect;
