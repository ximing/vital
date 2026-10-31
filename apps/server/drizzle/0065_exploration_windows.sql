ALTER TABLE "continuity_user_settings" ADD COLUMN "region" varchar(8);
--> statement-breakpoint
CREATE TABLE "holiday_calendar_sources" (
	"region" varchar(8) PRIMARY KEY NOT NULL,
	"source_url" text DEFAULT '' NOT NULL,
	"fetched_at" timestamp with time zone,
	"coverage_from" date,
	"coverage_to" date,
	"source_version" varchar(32) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exploration_windows" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"window_key" varchar(128) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"region" varchar(8),
	"calendar_version" varchar(32) NOT NULL,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"closed_reason" varchar(64),
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exploration_windows_user_key_uidx" UNIQUE("user_id","window_key"),
	CONSTRAINT "exploration_windows_status_check" CHECK ("exploration_windows"."status" IN ('open', 'closed', 'rest'))
);
--> statement-breakpoint
CREATE INDEX "idx_exploration_windows_user_dates" ON "exploration_windows" USING btree ("user_id","start_date","end_date");
--> statement-breakpoint
CREATE TABLE "exploration_proposals" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"window_id" char(36) NOT NULL,
	"activity_key" varchar(128) NOT NULL,
	"status" varchar(16) DEFAULT 'proposed' NOT NULL,
	"interest_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exploration_proposals_window_activity_uidx" UNIQUE("window_id","activity_key"),
	CONSTRAINT "exploration_proposals_status_check" CHECK ("exploration_proposals"."status" IN ('proposed', 'selected', 'verification_pending', 'draft_ready', 'confirmed', 'completed', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX "idx_exploration_proposals_user_window" ON "exploration_proposals" USING btree ("user_id","window_id");
--> statement-breakpoint
CREATE TABLE "exploration_verifications" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"proposal_id" char(36) NOT NULL,
	"stage" varchar(32) DEFAULT 'initial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_exploration_verifications_user_proposal" ON "exploration_verifications" USING btree ("user_id","proposal_id");
