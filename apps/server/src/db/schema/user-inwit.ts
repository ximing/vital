import { char, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

/** Per-user inwit integration config. accessKey is encryptSecret() output. */
export const userInwitConfig = pgTable('user_inwit_config', {
  userId: char('user_id', { length: 36 }).primaryKey(),
  baseUrl: varchar('base_url', { length: 512 }).notNull(),
  accessKeyEnc: text('access_key_enc').notNull(),
  defaultTopicId: char('default_topic_id', { length: 36 }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type UserInwitConfigRow = typeof userInwitConfig.$inferSelect;
export type NewUserInwitConfig = typeof userInwitConfig.$inferInsert;
