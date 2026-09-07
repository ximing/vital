import { type SQL, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  type AnyPgColumn,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { lists } from './lists.js';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const tasks = pgTable(
  'tasks',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listId: char('list_id', { length: 36 })
      .notNull()
      .references(() => lists.id, { onDelete: 'restrict' }),
    parentId: char('parent_id', { length: 36 }).references((): AnyPgColumn => tasks.id, {
      onDelete: 'cascade',
    }),
    title: varchar('title', { length: 500 }).notNull(),
    notesMd: text('notes_md').notNull().default(''),
    status: varchar('status', { length: 16 }).notNull().default('todo'),
    priority: smallint('priority').notNull().default(3),
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }),
    reminderMode: varchar('reminder_mode', { length: 16 }),
    reminderOffsetMinutes: smallint('reminder_offset_minutes'),
    reminderAt: timestamp('reminder_at', { withTimezone: true, mode: 'date' }),
    isAllDay: boolean('is_all_day').notNull().default(false),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    timeBucket: varchar('time_bucket', { length: 16 }).notNull().default('anytime'),
    recurrenceRrule: text('recurrence_rrule'),
    recurrenceKind: varchar('recurrence_kind', { length: 32 }),
    recurrenceDtstart: timestamp('recurrence_dtstart', { withTimezone: true, mode: 'date' }),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    sortOrder: bigint('sort_order', { mode: 'number' }).notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    searchTsv: tsvector('search_tsv')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('simple', coalesce(${tasks.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${tasks.notesMd}, '')), 'B')`,
      ),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_tasks_user_list_sort').on(t.userId, t.listId, t.sortOrder),
    index('idx_tasks_user_status_due').on(t.userId, t.status, t.dueAt),
    index('idx_tasks_user_updated').on(t.userId, t.updatedAt),
    index('idx_tasks_search_tsv').using('gin', t.searchTsv),
    index('idx_tasks_title_trgm').using('gin', sql`${t.title} gin_trgm_ops`),
    check('tasks_status_check', sql`${t.status} IN ('todo', 'doing', 'done', 'canceled')`),
    check('tasks_priority_check', sql`${t.priority} BETWEEN 0 AND 3`),
    check('tasks_time_bucket_check', sql`${t.timeBucket} IN ('dated', 'anytime', 'someday')`),
    check('tasks_reminder_mode_check', sql`${t.reminderMode} IS NULL OR ${t.reminderMode} IN ('none', 'due', 'offset', 'custom')`),
    check('tasks_recurrence_kind_check', sql`${t.recurrenceKind} IS NULL OR ${t.recurrenceKind} IN ('daily', 'weekly', 'monthly', 'yearly', 'weekdays', 'weekends', 'holidays', 'legal_workdays')`),
  ],
);

export const taskCompletions = pgTable(
  'task_completions',
  {
    id: char('id', { length: 36 }).primaryKey(),
    taskId: char('task_id', { length: 36 })
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    occurrenceAt: timestamp('occurrence_at', { withTimezone: true, mode: 'date' }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }).notNull(),
    dueWasNull: boolean('due_was_null').notNull(),
  },
  (t) => [unique('task_completions_task_occurrence_uidx').on(t.taskId, t.occurrenceAt)],
);

export type TaskRow = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskCompletionRow = typeof taskCompletions.$inferSelect;
export type NewTaskCompletion = typeof taskCompletions.$inferInsert;
