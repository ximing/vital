import { sql } from 'drizzle-orm';
import { bigserial, char, check, index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    authMode: varchar('auth_mode', { length: 16 }).notNull(),
    deviceInfo: varchar('device_info', { length: 255 }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_refresh_tokens_user').on(t.userId),
    check('refresh_tokens_auth_mode_check', sql`${t.authMode} IN ('cookie', 'bearer')`),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
