ALTER TABLE "users" ADD COLUMN "notify_morning_brief" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "morning_brief_time" varchar(5) DEFAULT '07:30' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_event_type_check";--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_event_type_check" CHECK ("notification_outbox"."event_type" IN ('task.remind', 'task.due', 'agent.insight', 'day.remind', 'task.digest', 'agent.briefing'));--> statement-breakpoint
ALTER TABLE "user_llm_routes" DROP CONSTRAINT "user_llm_routes_capability_check";--> statement-breakpoint
ALTER TABLE "user_llm_routes" ADD CONSTRAINT "user_llm_routes_capability_check" CHECK ("user_llm_routes"."capability" IN ('default', 'task.parse', 'agent.headline', 'agent.cluster', 'agent.decompose', 'agent.draft', 'agent.report', 'agent.reflect', 'agent.distill', 'agent.notify', 'agent.critic', 'agent.chat', 'agent.briefing'));
