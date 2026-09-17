ALTER TABLE "users" ADD COLUMN "notify_day_remind" boolean DEFAULT true NOT NULL;

ALTER TABLE "attachments" DROP CONSTRAINT "attachments_owner_type_check";
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_type_check"
  CHECK ("owner_type" IN ('tmp', 'task', 'inbox', 'report', 'user', 'list', 'day'));

ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_event_type_check";
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_event_type_check"
  CHECK ("event_type" IN ('task.remind', 'task.due', 'agent.insight', 'day.remind'));

ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_entity_type_check";
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_entity_type_check"
  CHECK ("entity_type" IN ('task', 'outcome', 'habit', 'day'));

CREATE TABLE "days" (
  "id" char(36) PRIMARY KEY NOT NULL,
  "user_id" char(36) NOT NULL,
  "name" varchar(80) NOT NULL,
  "note" varchar(200) DEFAULT '' NOT NULL,
  "source" varchar(16) NOT NULL,
  "catalog_key" varchar(64),
  "calendar" varchar(8) NOT NULL,
  "repeat" varchar(8) DEFAULT 'none' NOT NULL,
  "display_mode" varchar(16) DEFAULT 'auto' NOT NULL,
  "anchor_ymd" date NOT NULL,
  "lunar_month" smallint,
  "lunar_day" smallint,
  "lunar_leap" boolean DEFAULT false NOT NULL,
  "time_hm" varchar(5),
  "cover_preset" varchar(32) DEFAULT 'mist' NOT NULL,
  "cover_attachment_id" char(36),
  "reminder_offsets" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "pinned" boolean DEFAULT false NOT NULL,
  "pin_order" integer DEFAULT 0 NOT NULL,
  "hidden" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "days_source_check" CHECK ("source" IN ('custom', 'statutory', 'catalog')),
  CONSTRAINT "days_calendar_check" CHECK ("calendar" IN ('solar', 'lunar')),
  CONSTRAINT "days_repeat_check" CHECK ("repeat" IN ('none', 'yearly')),
  CONSTRAINT "days_display_mode_check" CHECK ("display_mode" IN ('auto', 'countdown', 'countup')),
  CONSTRAINT "days_lunar_check" CHECK (
    ("calendar" = 'solar' AND "lunar_month" IS NULL AND "lunar_day" IS NULL)
    OR ("calendar" = 'lunar' AND "lunar_month" BETWEEN 1 AND 12 AND "lunar_day" BETWEEN 1 AND 30)
  )
);

CREATE INDEX "idx_days_user_hidden" ON "days" ("user_id", "hidden");
CREATE UNIQUE INDEX "days_user_catalog_uidx" ON "days" ("user_id", "catalog_key") WHERE "catalog_key" IS NOT NULL;
