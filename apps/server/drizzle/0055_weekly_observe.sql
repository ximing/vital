ALTER TABLE "users" ADD COLUMN "notify_weekly_observe" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_jobs" DROP CONSTRAINT "agent_jobs_type_check";--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_type_check" CHECK ("agent_jobs"."job_type" IN ('outcome.refresh', 'outcome.cluster', 'task.decompose', 'task.draft', 'reflect.daily', 'reflect.weekly', 'memory.distill', 'habit.spawn', 'notify.scan', 'index.sync', 'report.generate', 'today.layout'));--> statement-breakpoint
ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_event_type_check";--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_event_type_check" CHECK ("notification_outbox"."event_type" IN ('task.remind', 'task.due', 'agent.insight', 'day.remind', 'task.digest', 'agent.briefing', 'meeting.prep', 'agent.observe'));--> statement-breakpoint
ALTER TABLE "user_llm_routes" DROP CONSTRAINT "user_llm_routes_capability_check";--> statement-breakpoint
ALTER TABLE "user_llm_routes" ADD CONSTRAINT "user_llm_routes_capability_check" CHECK ("user_llm_routes"."capability" IN ('default', 'task.parse', 'agent.headline', 'agent.cluster', 'agent.decompose', 'agent.draft', 'agent.report', 'agent.reflect', 'agent.distill', 'agent.notify', 'agent.critic', 'agent.chat', 'agent.briefing', 'agent.observe'));
