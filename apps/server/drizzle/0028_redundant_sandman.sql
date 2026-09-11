CREATE TABLE "agent_edit_events" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"entity_type" varchar(16) NOT NULL,
	"entity_id" char(36) NOT NULL,
	"fields" jsonb NOT NULL,
	"source" varchar(16) DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_edit_events_entity_type_check" CHECK ("agent_edit_events"."entity_type" IN ('task', 'outcome')),
	CONSTRAINT "agent_edit_events_source_check" CHECK ("agent_edit_events"."source" IN ('user', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "agent_edit_feedback" (
	"user_id" char(36) NOT NULL,
	"event_id" char(36) NOT NULL,
	"job_id" char(36) NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_edit_feedback_user_id_event_id_pk" PRIMARY KEY("user_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "agent_actions" DROP CONSTRAINT "agent_actions_feedback_check";--> statement-breakpoint
ALTER TABLE "agent_edit_events" ADD CONSTRAINT "agent_edit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_edit_feedback" ADD CONSTRAINT "agent_edit_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_edit_events_user_created" ON "agent_edit_events" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_feedback_check" CHECK ("agent_actions"."feedback" IN ('pending', 'accepted', 'edited', 'dismissed', 'undone'));