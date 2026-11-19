import { char, pgTable, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

/** This app's user id paired with one Keycloak (issuer, sub). No foreign key. */
export const oidcIdentities = pgTable(
  'oidc_identities',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 }).notNull(),
    issuer: varchar('issuer', { length: 512 }).notNull(),
    sub: varchar('sub', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('oidc_identities_issuer_sub_uidx').on(t.issuer, t.sub),
    uniqueIndex('oidc_identities_user_issuer_uidx').on(t.userId, t.issuer),
  ],
);

export type OidcIdentity = typeof oidcIdentities.$inferSelect;
export type NewOidcIdentity = typeof oidcIdentities.$inferInsert;
