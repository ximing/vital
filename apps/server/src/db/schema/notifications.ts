import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';

export type MeowChannelConfig = { nickname: string };

export const notificationChannels = pgTable(
  'notification_channels',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').$type<MeowChannelConfig>().notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true, mode: 'date' }),
    lastError: varchar('last_error', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('notification_channels_user_type_uidx').on(t.userId, t.type),
    index('idx_notification_channels_user').on(t.userId),
    check('notification_channels_type_check', sql`${t.type} IN ('meow')`),
  ],
);

export type NotificationOutboxPayload = {
  title: string;
  listId: string;
  listName: string;
  dueAt: string | null;
  remindAt: string | null;
  isAllDay: boolean;
  timezone: string;
  eventType: 'task.remind' | 'task.due' | 'agent.insight';
  insightKind?: 'outcome.stale' | 'task.decompose' | 'habit.window' | 'review.missing';
  message?: string;
};

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: char('id', { length: 36 }).primaryKey(),
    userId: char('user_id', { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 32 }).notNull(),
    entityType: varchar('entity_type', { length: 16 }).notNull(),
    entityId: char('entity_id', { length: 36 }).notNull(),
    occurrenceAt: timestamp('occurrence_at', { withTimezone: true, mode: 'date' }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 180 }).notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
    lastError: text('last_error'),
    payload: jsonb('payload').$type<NotificationOutboxPayload>().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('notification_outbox_idempotency_uidx').on(t.idempotencyKey),
    index('idx_notification_outbox_due').on(t.status, t.scheduledAt),
    index('idx_notification_outbox_entity').on(t.entityType, t.entityId, t.status),
    check(
      'notification_outbox_status_check',
      sql`${t.status} IN ('pending', 'sending', 'sent', 'failed', 'cancelled')`,
    ),
    check('notification_outbox_event_type_check', sql`${t.eventType} IN ('task.remind', 'task.due', 'agent.insight')`),
    check('notification_outbox_entity_type_check', sql`${t.entityType} IN ('task', 'outcome', 'habit')`),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: char('id', { length: 36 }).primaryKey(),
    outboxId: char('outbox_id', { length: 36 })
      .notNull()
      .references(() => notificationOutbox.id, { onDelete: 'cascade' }),
    channelId: char('channel_id', { length: 36 })
      .notNull()
      .references(() => notificationChannels.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull(),
    permanent: boolean('permanent').notNull().default(false),
    lastError: varchar('last_error', { length: 500 }),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('notification_deliveries_outbox_channel_uidx').on(t.outboxId, t.channelId),
    index('idx_notification_deliveries_outbox').on(t.outboxId),
    check('notification_deliveries_status_check', sql`${t.status} IN ('sent', 'failed')`),
  ],
);

export type NotificationChannelRow = typeof notificationChannels.$inferSelect;
export type NewNotificationChannel = typeof notificationChannels.$inferInsert;
export type NotificationOutboxRow = typeof notificationOutbox.$inferSelect;
export type NewNotificationOutbox = typeof notificationOutbox.$inferInsert;
export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
