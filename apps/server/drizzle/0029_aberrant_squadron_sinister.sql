ALTER TABLE "agent_actions" DROP CONSTRAINT "agent_actions_type_check";--> statement-breakpoint
ALTER TABLE "agent_actions" DROP CONSTRAINT "agent_actions_target_type_check";--> statement-breakpoint
ALTER TABLE "agent_jobs" DROP CONSTRAINT "agent_jobs_type_check";--> statement-breakpoint
ALTER TABLE "agent_memory" DROP CONSTRAINT "agent_memory_scope_check";--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_type_check" CHECK ("agent_actions"."action_type" IN ('outcome.create', 'outcome.headline', 'outcome.suggestion', 'task.decompose', 'task.draft', 'habit.create', 'habit.adjust', 'habit.nudge', 'report.generate'));--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_target_type_check" CHECK ("agent_actions"."target_type" IN ('outcome', 'task', 'habit', 'report'));--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_type_check" CHECK ("agent_jobs"."job_type" IN ('outcome.refresh', 'outcome.cluster', 'task.decompose', 'task.draft', 'reflect.daily', 'memory.distill', 'habit.spawn', 'notify.scan', 'index.sync', 'report.generate'));--> statement-breakpoint
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_scope_check" CHECK ("agent_memory"."scope" <> '{}' AND "agent_memory"."scope" <@ ARRAY['all', 'headline', 'cluster', 'decompose', 'draft', 'reflect', 'distill', 'notify', 'report']::text[]);