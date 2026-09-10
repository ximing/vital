ALTER TABLE "agent_jobs" DROP CONSTRAINT "agent_jobs_type_check";--> statement-breakpoint
ALTER TABLE "agent_usage" DROP CONSTRAINT "agent_usage_capability_check";--> statement-breakpoint
ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_event_type_check";--> statement-breakpoint
ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_entity_type_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_agent_insights" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_type_check" CHECK ("agent_jobs"."job_type" IN ('outcome.refresh', 'outcome.cluster', 'task.decompose', 'reflect.daily', 'memory.distill', 'habit.spawn', 'notify.scan'));--> statement-breakpoint
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_capability_check" CHECK ("agent_usage"."capability" IN ('parse', 'headline', 'suggestion', 'cluster', 'decompose', 'reflect', 'distill', 'notify', 'critic'));--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_event_type_check" CHECK ("notification_outbox"."event_type" IN ('task.remind', 'task.due', 'agent.insight'));--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_entity_type_check" CHECK ("notification_outbox"."entity_type" IN ('task', 'outcome', 'habit'));
