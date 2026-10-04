import { sql } from 'drizzle-orm';
import { char, check, index, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const qrLoginTickets = pgTable(
  'qr_login_tickets',
  {
    id: char('id', { length: 36 }).primaryKey(),
    secretHash: char('secret_hash', { length: 64 }).notNull().unique(),
    status: varchar('status', { length: 16 }).notNull(),
    userId: char('user_id', { length: 36 }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_qr_login_tickets_expires').on(t.expiresAt),
    check(
      'qr_login_tickets_status_check',
      sql`${t.status} IN ('pending', 'scanned', 'confirmed', 'consumed', 'cancelled')`,
    ),
  ],
);

export type QrLoginTicketRow = typeof qrLoginTickets.$inferSelect;
