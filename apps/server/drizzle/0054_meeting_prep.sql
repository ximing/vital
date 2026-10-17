ALTER TABLE "users" ADD COLUMN "notify_meeting_prep" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_event_type_check";--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_event_type_check" CHECK ("notification_outbox"."event_type" IN ('task.remind', 'task.due', 'agent.insight', 'day.remind', 'task.digest', 'agent.briefing', 'meeting.prep'));
