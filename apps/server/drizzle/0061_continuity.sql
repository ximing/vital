CREATE TABLE "continuity_user_settings" (
	"user_id" char(36) PRIMARY KEY NOT NULL,
	"exploration_weekend" boolean DEFAULT false NOT NULL,
	"exploration_holiday" boolean DEFAULT false NOT NULL,
	"external_search" boolean DEFAULT false NOT NULL,
	"daily_push_limit" integer DEFAULT 1 NOT NULL,
	"weekly_push_limit" integer DEFAULT 3 NOT NULL,
	"default_cadence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_user_settings_daily_push_check" CHECK ("continuity_user_settings"."daily_push_limit" BETWEEN 1 AND 5),
	CONSTRAINT "continuity_user_settings_weekly_push_check" CHECK ("continuity_user_settings"."weekly_push_limit" BETWEEN 1 AND 14)
);
--> statement-breakpoint
CREATE TABLE "continuity_contracts" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"outcome_id" char(36) NOT NULL,
	"lifecycle" varchar(16) DEFAULT 'draft' NOT NULL,
	"judgement" varchar(16),
	"current_revision" integer DEFAULT 0 NOT NULL,
	"authorization_version" integer DEFAULT 0 NOT NULL,
	"facts_version" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"in_app_only_until" timestamp with time zone,
	"unanswered_streak" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_contracts_user_outcome_uidx" UNIQUE("user_id","outcome_id"),
	CONSTRAINT "continuity_contracts_lifecycle_check" CHECK ("continuity_contracts"."lifecycle" IN ('draft', 'active', 'paused', 'ended')),
	CONSTRAINT "continuity_contracts_judgement_check" CHECK ("continuity_contracts"."judgement" IS NULL OR "continuity_contracts"."judgement" IN ('on_track', 'watching', 'needs_adjust', 'waiting'))
);
--> statement-breakpoint
CREATE INDEX "idx_continuity_contracts_user_lifecycle_check" ON "continuity_contracts" USING btree ("user_id","lifecycle","next_check_at");
--> statement-breakpoint
CREATE TABLE "continuity_contract_revisions" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"contract_id" char(36) NOT NULL,
	"revision" integer NOT NULL,
	"meaning" text DEFAULT '' NOT NULL,
	"stage_goal" text DEFAULT '' NOT NULL,
	"completion_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cadence" jsonb NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"week_starts_on" smallint NOT NULL,
	"min_action" jsonb NOT NULL,
	"evidence_bindings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actionable_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"authorization" jsonb NOT NULL,
	"concern_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" varchar(128),
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_contract_revisions_contract_revision_uidx" UNIQUE("contract_id","revision"),
	CONSTRAINT "continuity_contract_revisions_week_starts_on_check" CHECK ("continuity_contract_revisions"."week_starts_on" IN (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "continuity_contract_revisions_idempotency_uidx" ON "continuity_contract_revisions" USING btree ("user_id","idempotency_key") WHERE "continuity_contract_revisions"."idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "continuity_opportunities" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"contract_id" char(36) NOT NULL,
	"revision" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"window_key" varchar(128) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"check_at" timestamp with time zone NOT NULL,
	"local_start_date" date NOT NULL,
	"local_end_date" date NOT NULL,
	"timezone_snapshot" varchar(64) NOT NULL,
	"target_count" integer DEFAULT 1 NOT NULL,
	"status" varchar(16) NOT NULL,
	"exempt_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_opportunities_window_uidx" UNIQUE("contract_id","revision","window_key"),
	CONSTRAINT "continuity_opportunities_kind_check" CHECK ("continuity_opportunities"."kind" IN ('timed', 'weekly_count')),
	CONSTRAINT "continuity_opportunities_status_check" CHECK ("continuity_opportunities"."status" IN ('scheduled', 'open', 'met', 'missed', 'exempt', 'canceled'))
);
--> statement-breakpoint
CREATE INDEX "idx_continuity_opportunities_user_check" ON "continuity_opportunities" USING btree ("user_id","check_at");
--> statement-breakpoint
CREATE INDEX "idx_continuity_opportunities_contract_status" ON "continuity_opportunities" USING btree ("contract_id","status");
--> statement-breakpoint
CREATE TABLE "continuity_evidence" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"source_type" varchar(16) NOT NULL,
	"source_id" char(36),
	"source_revision" integer,
	"actor" varchar(16) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"supersedes_id" char(36),
	"retracted_at" timestamp with time zone,
	"idempotency_key" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_evidence_source_type_check" CHECK ("continuity_evidence"."source_type" IN ('task_done', 'habit_checkin', 'self_report', 'user_confirm', 'agent_prep')),
	CONSTRAINT "continuity_evidence_actor_check" CHECK ("continuity_evidence"."actor" IN ('user', 'agent', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "continuity_evidence_source_uidx" ON "continuity_evidence" USING btree ("user_id","source_type","source_id","source_revision") WHERE "continuity_evidence"."source_id" IS NOT NULL AND "continuity_evidence"."retracted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "continuity_evidence_idempotency_uidx" ON "continuity_evidence" USING btree ("user_id","idempotency_key") WHERE "continuity_evidence"."idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_continuity_evidence_user_occurred" ON "continuity_evidence" USING btree ("user_id","occurred_at");
--> statement-breakpoint
CREATE TABLE "continuity_evidence_links" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"evidence_id" char(36) NOT NULL,
	"contract_id" char(36) NOT NULL,
	"opportunity_id" char(36),
	"meets_criteria" boolean DEFAULT false NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_evidence_links_pair_uidx" UNIQUE("evidence_id","contract_id")
);
--> statement-breakpoint
CREATE TABLE "continuity_interventions" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"contract_id" char(36) NOT NULL,
	"revision" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"fact_fingerprint" varchar(128) NOT NULL,
	"status" varchar(16) NOT NULL,
	"expires_at" timestamp with time zone,
	"actionable_until" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_ref" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_interventions_kind_check" CHECK ("continuity_interventions"."kind" IN ('stall_adjust', 'work_risk', 'explore', 'experiment_review')),
	CONSTRAINT "continuity_interventions_status_check" CHECK ("continuity_interventions"."status" IN ('open', 'snoozed', 'accepted', 'dismissed', 'resolved', 'expired', 'withdrawn'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "continuity_interventions_open_uidx" ON "continuity_interventions" USING btree ("contract_id","kind","fact_fingerprint","revision") WHERE "continuity_interventions"."status" IN ('open', 'snoozed');
--> statement-breakpoint
CREATE INDEX "idx_continuity_interventions_user_status_expires" ON "continuity_interventions" USING btree ("user_id","status","expires_at");
--> statement-breakpoint
CREATE TABLE "continuity_experiments" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"contract_id" char(36) NOT NULL,
	"before_revision" integer NOT NULL,
	"after_revision" integer NOT NULL,
	"hypothesis" text DEFAULT '' NOT NULL,
	"baseline" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"goal" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"plan_id" char(36),
	"status" varchar(16) NOT NULL,
	"review" jsonb,
	"review_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_experiments_status_check" CHECK ("continuity_experiments"."status" IN ('draft', 'active', 'review_ready', 'completed', 'interrupted', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "continuity_experiments_active_uidx" ON "continuity_experiments" USING btree ("contract_id") WHERE "continuity_experiments"."status" IN ('draft', 'active', 'review_ready');
--> statement-breakpoint
CREATE TABLE "continuity_events" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"aggregate_id" char(36) NOT NULL,
	"sequence" integer NOT NULL,
	"type" varchar(64) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_events_aggregate_sequence_uidx" UNIQUE("aggregate_id","sequence")
);
--> statement-breakpoint
CREATE INDEX "idx_continuity_events_unprocessed" ON "continuity_events" USING btree ("created_at") WHERE "continuity_events"."processed_at" IS NULL;
--> statement-breakpoint
CREATE TABLE "continuity_exposures" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"candidate_id" char(36) NOT NULL,
	"surface" varchar(32) NOT NULL,
	"reserved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"handled_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"budget_class" varchar(16) NOT NULL,
	"period_key" varchar(16) NOT NULL,
	"outbox_id" char(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_exposures_surface_check" CHECK ("continuity_exposures"."surface" IN ('today', 'morning_brief', 'evening_digest', 'weekly', 'push')),
	CONSTRAINT "continuity_exposures_budget_class_check" CHECK ("continuity_exposures"."budget_class" IN ('ordinary', 'work_risk'))
);
--> statement-breakpoint
CREATE INDEX "idx_continuity_exposures_user_period_budget" ON "continuity_exposures" USING btree ("user_id","period_key","budget_class");
--> statement-breakpoint
CREATE INDEX "idx_continuity_exposures_candidate_surface" ON "continuity_exposures" USING btree ("candidate_id","surface");
--> statement-breakpoint
CREATE TABLE "continuity_memory_suppressions" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"topic_fingerprint" varchar(128) NOT NULL,
	"evidence_fingerprint" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_memory_suppressions_uidx" UNIQUE("user_id","topic_fingerprint","evidence_fingerprint")
);
