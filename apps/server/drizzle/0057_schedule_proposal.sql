ALTER TABLE "users" ADD COLUMN "schedule_suggest" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_hours_start" varchar(5) DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_hours_end" varchar(5) DEFAULT '18:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "schedule_day_cap_minutes" integer DEFAULT 540 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_work_hours_check" CHECK ("work_hours_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "work_hours_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "work_hours_end" > "work_hours_start");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_schedule_day_cap_check" CHECK ("schedule_day_cap_minutes" BETWEEN 30 AND 1440);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "agent_scheduled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "calendar_end_at" timestamp with time zone;
