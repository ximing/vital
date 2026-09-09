CREATE TABLE "outcomes" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" varchar(8) DEFAULT 'open' NOT NULL,
	"created_by" varchar(8) DEFAULT 'user' NOT NULL,
	"rule_signal" varchar(8),
	"rule_next_step" text,
	"rule_updated_at" timestamp with time zone,
	"agent_headline" text,
	"agent_suggestion" text,
	"agent_state" varchar(16) DEFAULT 'idle' NOT NULL,
	"agent_updated_at" timestamp with time zone,
	"undo_until" timestamp with time zone,
	"last_activity_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_status_check" CHECK ("outcomes"."status" IN ('open', 'closed')),
	CONSTRAINT "outcomes_created_by_check" CHECK ("outcomes"."created_by" IN ('user', 'agent')),
	CONSTRAINT "outcomes_rule_signal_check" CHECK ("outcomes"."rule_signal" IS NULL OR "outcomes"."rule_signal" IN ('up', 'flat', 'alert')),
	CONSTRAINT "outcomes_agent_state_check" CHECK ("outcomes"."agent_state" IN ('idle', 'pending', 'failed'))
);--> statement-breakpoint
CREATE TABLE "agent_actions" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"job_id" char(36),
	"action_type" varchar(32) NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" char(36) NOT NULL,
	"payload" jsonb NOT NULL,
	"feedback" varchar(16) DEFAULT 'pending' NOT NULL,
	"feedback_payload" jsonb,
	"feedback_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_actions_type_check" CHECK ("agent_actions"."action_type" IN ('outcome.create', 'outcome.headline', 'outcome.suggestion', 'task.decompose', 'habit.create', 'habit.adjust', 'habit.nudge')),
	CONSTRAINT "agent_actions_target_type_check" CHECK ("agent_actions"."target_type" IN ('outcome', 'task', 'habit')),
	CONSTRAINT "agent_actions_feedback_check" CHECK ("agent_actions"."feedback" IN ('pending', 'accepted', 'edited', 'dismissed'))
);--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"job_type" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"dedup_key" varchar(180) NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_jobs_dedup_key_unique" UNIQUE("dedup_key"),
	CONSTRAINT "agent_jobs_type_check" CHECK ("agent_jobs"."job_type" IN ('outcome.refresh', 'outcome.cluster', 'task.decompose', 'reflect.daily', 'memory.distill', 'habit.spawn')),
	CONSTRAINT "agent_jobs_status_check" CHECK ("agent_jobs"."status" IN ('pending', 'running', 'done', 'failed', 'cancelled'))
);--> statement-breakpoint
CREATE TABLE "agent_memory" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"source_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_memory_kind_check" CHECK ("agent_memory"."kind" IN ('preference', 'pattern', 'correction'))
);--> statement-breakpoint
CREATE TABLE "agent_usage" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"job_id" char(36) NOT NULL,
	"capability" varchar(24) NOT NULL,
	"model" varchar(120) NOT NULL,
	"prompt_tokens" integer NOT NULL,
	"completion_tokens" integer NOT NULL,
	"cost_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_usage_capability_check" CHECK ("agent_usage"."capability" IN ('parse', 'headline', 'suggestion', 'cluster', 'decompose', 'reflect', 'distill', 'critic'))
);--> statement-breakpoint
CREATE TABLE "habits" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"target_count" integer,
	"window_start" varchar(5),
	"window_end" varchar(5),
	"active" boolean DEFAULT true NOT NULL,
	"created_by" varchar(8) DEFAULT 'user' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habits_kind_check" CHECK ("habits"."kind" IN ('daily', 'count')),
	CONSTRAINT "habits_created_by_check" CHECK ("habits"."created_by" IN ('user', 'agent')),
	CONSTRAINT "habits_target_count_check" CHECK (("habits"."kind" = 'count' AND "habits"."target_count" IS NOT NULL AND "habits"."target_count" BETWEEN 1 AND 99) OR ("habits"."kind" = 'daily' AND "habits"."target_count" IS NULL))
);--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habits" ADD CONSTRAINT "habits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_outcomes_user_status" ON "outcomes" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_outcomes_user_sort" ON "outcomes" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_agent_actions_user_feedback" ON "agent_actions" USING btree ("user_id","feedback");--> statement-breakpoint
CREATE INDEX "idx_agent_actions_target" ON "agent_actions" USING btree ("target_type","target_id","feedback");--> statement-breakpoint
CREATE INDEX "idx_agent_jobs_due" ON "agent_jobs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_agent_jobs_user_type" ON "agent_jobs" USING btree ("user_id","job_type");--> statement-breakpoint
CREATE INDEX "idx_agent_memory_user_kind" ON "agent_memory" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "idx_agent_usage_user_created" ON "agent_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_habits_user_active" ON "habits" USING btree ("user_id","active");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "llm_api_base";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "llm_api_key";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "llm_model";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "llm_parameters";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "llm_providers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "llm_routing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "outcome_id" char(36);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "defer_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "habit_id" char(36);--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "habit_seq" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "habit_key" varchar(80);--> statement-breakpoint
CREATE INDEX "idx_tasks_user_outcome" ON "tasks" USING btree ("user_id","outcome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tasks_habit_key" ON "tasks" USING btree ("habit_key") WHERE "tasks"."habit_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "outcome_id" char(36);

