ALTER TABLE "agent_jobs" DROP CONSTRAINT "agent_jobs_type_check";--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_type_check" CHECK ("agent_jobs"."job_type" IN ('outcome.refresh', 'outcome.cluster', 'task.decompose', 'task.draft', 'reflect.daily', 'memory.distill', 'habit.spawn', 'notify.scan', 'index.sync', 'report.generate', 'today.layout'));--> statement-breakpoint
CREATE TABLE "today_layouts" (
	"user_id" char(36) PRIMARY KEY NOT NULL,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
