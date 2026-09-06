ALTER TABLE "users" ADD COLUMN "notify_task_remind" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_task_due" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quiet_hours_start" varchar(5);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quiet_hours_end" varchar(5);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "all_day_notify_time" varchar(5) DEFAULT '09:00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_quiet_hours_pair_check" CHECK (("quiet_hours_start" IS NULL AND "quiet_hours_end" IS NULL) OR ("quiet_hours_start" IS NOT NULL AND "quiet_hours_end" IS NOT NULL));
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"type" varchar(16) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"last_success_at" timestamptz,
	"last_error" varchar(500),
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "notification_channels_type_check" CHECK ("type" IN ('meow')),
	CONSTRAINT "notification_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_channels_user_type_uidx" ON "notification_channels" ("user_id", "type");
--> statement-breakpoint
CREATE INDEX "idx_notification_channels_user" ON "notification_channels" ("user_id");
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"entity_type" varchar(16) NOT NULL,
	"entity_id" char(36) NOT NULL,
	"occurrence_at" timestamptz NOT NULL,
	"idempotency_key" varchar(180) NOT NULL,
	"scheduled_at" timestamptz NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamptz,
	"last_error" text,
	"payload" jsonb NOT NULL,
	"sent_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_status_check" CHECK ("status" IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "notification_outbox_event_type_check" CHECK ("event_type" IN ('task.remind', 'task.due')),
	CONSTRAINT "notification_outbox_entity_type_check" CHECK ("entity_type" IN ('task')),
	CONSTRAINT "notification_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_idempotency_uidx" ON "notification_outbox" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "idx_notification_outbox_due" ON "notification_outbox" ("status", "scheduled_at");
--> statement-breakpoint
CREATE INDEX "idx_notification_outbox_entity" ON "notification_outbox" ("entity_type", "entity_id", "status");
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"outbox_id" char(36) NOT NULL,
	"channel_id" char(36) NOT NULL,
	"status" varchar(16) NOT NULL,
	"permanent" boolean DEFAULT false NOT NULL,
	"last_error" varchar(500),
	"sent_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_status_check" CHECK ("status" IN ('sent', 'failed')),
	CONSTRAINT "notification_deliveries_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "notification_outbox"("id") ON DELETE CASCADE,
	CONSTRAINT "notification_deliveries_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_outbox_channel_uidx" ON "notification_deliveries" ("outbox_id", "channel_id");
--> statement-breakpoint
CREATE INDEX "idx_notification_deliveries_outbox" ON "notification_deliveries" ("outbox_id");
