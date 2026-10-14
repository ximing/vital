ALTER TABLE "tasks" ADD COLUMN "calendar_key" varchar(200);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tasks_user_calendar_key" ON "tasks" ("user_id", "calendar_key") WHERE "calendar_key" IS NOT NULL;
