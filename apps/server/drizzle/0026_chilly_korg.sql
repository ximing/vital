CREATE TABLE "agent_model_budgets" (
	"user_id" char(36) NOT NULL,
	"day" date NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_model_budgets_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "agent_scheduling" (
	"user_id" char(36) NOT NULL,
	"capability" varchar(32) NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"processed_generation" bigint DEFAULT 0 NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"pending_since" timestamp with time zone,
	"due_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"observed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_scheduling_user_id_capability_pk" PRIMARY KEY("user_id","capability")
);
--> statement-breakpoint
CREATE TABLE "agent_memory_feedback" (
	"user_id" char(36) NOT NULL,
	"action_id" char(36) NOT NULL,
	"version" text NOT NULL,
	"feedback_at" timestamp with time zone NOT NULL,
	"job_id" char(36) NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_memory_feedback_user_id_action_id_version_pk" PRIMARY KEY("user_id","action_id","version")
);
--> statement-breakpoint
CREATE TABLE "agent_memory_history" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"memory_id" char(36) NOT NULL,
	"revision" integer NOT NULL,
	"operation" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"source_feedback" jsonb NOT NULL,
	"job_id" char(36),
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memory_maintenance" (
	"user_id" char(36) PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_status_check";--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "lease_token" char(36);--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "job_generation" integer;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "trigger" varchar(80);--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "input_summary" text;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD COLUMN "heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "claimed_generation" integer;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "claimed_payload" jsonb;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "applied_generation" integer;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "effect_result" jsonb;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "lease_token" char(36);--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "first_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD COLUMN "lease_token" char(36);--> statement-breakpoint
ALTER TABLE "agent_usage" ADD COLUMN "job_generation" integer;--> statement-breakpoint
ALTER TABLE "agent_model_budgets" ADD CONSTRAINT "agent_model_budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_scheduling" ADD CONSTRAINT "agent_scheduling_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_feedback" ADD CONSTRAINT "agent_memory_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_history" ADD CONSTRAINT "agent_memory_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory_maintenance" ADD CONSTRAINT "agent_memory_maintenance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_scheduling_due" ON "agent_scheduling" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "idx_agent_memory_history_user_memory" ON "agent_memory_history" USING btree ("user_id","memory_id");--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_status_check" CHECK ("notification_outbox"."status" IN ('preparing', 'pending', 'sending', 'sent', 'failed', 'cancelled'));