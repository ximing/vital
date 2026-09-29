CREATE TABLE "inbox_extract_jobs" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"status" varchar(16) NOT NULL,
	"preview" jsonb,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "inbox_extract_jobs_status_check" CHECK ("inbox_extract_jobs"."status" IN ('queued', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_extract_jobs_inflight_uidx" ON "inbox_extract_jobs" USING btree ("user_id","canonical_url") WHERE "inbox_extract_jobs"."status" IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX "idx_inbox_extract_jobs_user_url" ON "inbox_extract_jobs" USING btree ("user_id","canonical_url","created_at");--> statement-breakpoint
CREATE INDEX "idx_inbox_extract_jobs_queued" ON "inbox_extract_jobs" USING btree ("created_at","id") WHERE "inbox_extract_jobs"."status" = 'queued';