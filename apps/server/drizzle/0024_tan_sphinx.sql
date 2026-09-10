CREATE TABLE "agent_executions" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"parent_id" char(36),
	"job_id" char(36),
	"capability" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"reason" varchar(80),
	"target_type" varchar(16),
	"target_id" char(36),
	"result_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	CONSTRAINT "agent_executions_status_check" CHECK ("agent_executions"."status" IN ('running', 'succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "agent_usage" DROP CONSTRAINT "agent_usage_capability_check";--> statement-breakpoint
ALTER TABLE "agent_usage" ALTER COLUMN "capability" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "agent_usage" ALTER COLUMN "prompt_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_usage" ALTER COLUMN "completion_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_usage" ALTER COLUMN "cost_micros" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD COLUMN "execution_id" char(36);--> statement-breakpoint
ALTER TABLE "agent_usage" ADD COLUMN "execution_id" char(36);--> statement-breakpoint
ALTER TABLE "agent_usage" ADD COLUMN "provider" varchar(120);--> statement-breakpoint
ALTER TABLE "agent_usage" ADD COLUMN "status" varchar(16) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD COLUMN "reason" varchar(80);--> statement-breakpoint
ALTER TABLE "agent_usage" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_executions_user_created" ON "agent_executions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_agent_executions_job" ON "agent_executions" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_execution_id_agent_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."agent_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_execution_id_agent_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."agent_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_status_check" CHECK ("agent_usage"."status" IN ('legacy', 'running', 'succeeded', 'failed'));