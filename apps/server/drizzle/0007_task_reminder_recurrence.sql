ALTER TABLE "tasks" ADD COLUMN "reminder_mode" varchar(16);
ALTER TABLE "tasks" ADD COLUMN "reminder_offset_minutes" smallint;
ALTER TABLE "tasks" ADD COLUMN "reminder_at" timestamp with time zone;
ALTER TABLE "tasks" ADD COLUMN "recurrence_kind" varchar(32);

UPDATE "tasks" SET "reminder_mode" = 'custom', "reminder_at" = "remind_at"
WHERE "remind_at" IS NOT NULL;

UPDATE "tasks" SET "recurrence_kind" = CASE
  WHEN "recurrence_rrule" = 'FREQ=DAILY' THEN 'daily'
  WHEN "recurrence_rrule" = 'FREQ=WEEKLY' THEN 'weekly'
  WHEN "recurrence_rrule" = 'FREQ=MONTHLY' THEN 'monthly'
  WHEN "recurrence_rrule" = 'FREQ=YEARLY' THEN 'yearly'
  ELSE NULL
END WHERE "recurrence_rrule" IS NOT NULL;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reminder_mode_check"
  CHECK ("reminder_mode" IS NULL OR "reminder_mode" IN ('none', 'due', 'offset', 'custom'));
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_kind_check"
  CHECK ("recurrence_kind" IS NULL OR "recurrence_kind" IN ('daily', 'weekly', 'monthly', 'yearly', 'weekdays', 'weekends', 'holidays', 'legal_workdays'));

CREATE TABLE "holiday_calendar" (
  "region" varchar(8) NOT NULL DEFAULT 'CN',
  "date" date NOT NULL,
  "kind" varchar(16) NOT NULL,
  "source_version" varchar(32) NOT NULL,
  CONSTRAINT "holiday_calendar_region_date_pk" PRIMARY KEY("region", "date"),
  CONSTRAINT "holiday_calendar_kind_check" CHECK ("kind" IN ('holiday', 'workday'))
);
