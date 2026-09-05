import { type SQL, sql } from 'drizzle-orm';
import {
  char,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import type { ReportSnapshot } from '@vital/dto';
import { users } from './users.js';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const reports = pgTable(
  'reports',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16 }).notNull(),
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    bodyMd: text('body_md').notNull(),
    revision: integer('revision').notNull().default(1),
    snapshotJson: jsonb('snapshot_json').$type<ReportSnapshot>(),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true, mode: 'date' }),
    searchTsv: tsvector('search_tsv')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('simple', coalesce(${reports.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${reports.bodyMd}, '')), 'B')`,
      ),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('reports_user_type_period_uidx').on(t.userId, t.type, t.periodStart),
    index('idx_reports_user_updated').on(t.userId, t.updatedAt),
    index('idx_reports_search_tsv').using('gin', t.searchTsv),
    index('idx_reports_title_trgm').using('gin', sql`${t.title} gin_trgm_ops`),
    check(
      'reports_type_check',
      sql`${t.type} IN ('daily', 'weekly', 'monthly', 'yearly')`,
    ),
  ],
);

export type ReportRow = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
