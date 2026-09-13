CREATE TABLE "user_llm_providers" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"provider_id" varchar(64) NOT NULL,
	"label" varchar(64) NOT NULL,
	"base_url" varchar(512),
	"api_key_enc" text NOT NULL,
	"models" jsonb NOT NULL,
	"model_parameters" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_llm_routes" (
	"user_id" char(36) NOT NULL,
	"capability" varchar(32) NOT NULL,
	"provider_id" char(36) NOT NULL,
	"model" varchar(128) NOT NULL,
	"parameters" jsonb,
	CONSTRAINT "user_llm_routes_user_id_capability_pk" PRIMARY KEY("user_id","capability"),
	CONSTRAINT "user_llm_routes_capability_check" CHECK ("user_llm_routes"."capability" IN ('default', 'task.parse', 'agent.headline', 'agent.cluster', 'agent.decompose', 'agent.draft', 'agent.report', 'agent.reflect', 'agent.distill', 'agent.notify', 'agent.critic'))
);
--> statement-breakpoint
CREATE TABLE "inbox_item_bodies" (
	"inbox_item_id" char(36) PRIMARY KEY NOT NULL,
	"extracted_text" text,
	"extracted_html" text
);
--> statement-breakpoint
INSERT INTO "inbox_item_bodies" ("inbox_item_id", "extracted_text", "extracted_html")
SELECT "id", "extracted_text", "extracted_html" FROM "inbox_items";
--> statement-breakpoint
INSERT INTO "user_llm_providers" ("id", "user_id", "provider_id", "label", "base_url", "api_key_enc", "models", "model_parameters", "created_at", "updated_at")
SELECT
	(p->>'id'),
	u."id",
	(p->>'providerId'),
	(p->>'label'),
	NULLIF(p->>'baseUrl', ''),
	COALESCE(p->>'apiKeyEnc', ''),
	COALESCE(p->'models', '[]'::jsonb),
	CASE WHEN p ? 'modelParameters' AND jsonb_typeof(p->'modelParameters') = 'object' THEN p->'modelParameters' ELSE NULL END,
	u."created_at",
	u."updated_at"
FROM "users" u,
LATERAL jsonb_array_elements(COALESCE(u."llm_providers", '[]'::jsonb)) AS p
WHERE jsonb_typeof(COALESCE(u."llm_providers", '[]'::jsonb)) = 'array'
	AND (p->>'id') IS NOT NULL
	AND (p->>'providerId') IS NOT NULL
	AND (p->>'label') IS NOT NULL;
--> statement-breakpoint
INSERT INTO "user_llm_routes" ("user_id", "capability", "provider_id", "model", "parameters")
SELECT
	u."id",
	e.key,
	e.value->>'providerId',
	e.value->>'model',
	CASE WHEN e.value ? 'parameters' AND jsonb_typeof(e.value->'parameters') = 'object' THEN e.value->'parameters' ELSE NULL END
FROM "users" u,
LATERAL jsonb_each(COALESCE(u."llm_routing", '{}'::jsonb)) AS e
WHERE jsonb_typeof(e.value) = 'object'
	AND e.value->>'providerId' IS NOT NULL
	AND e.value->>'model' IS NOT NULL
	AND e.key IN ('default', 'task.parse', 'agent.headline', 'agent.cluster', 'agent.decompose', 'agent.draft', 'agent.report', 'agent.reflect', 'agent.distill', 'agent.notify', 'agent.critic');
--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "lists" DROP CONSTRAINT "lists_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "lists" DROP CONSTRAINT "lists_parent_id_lists_id_fk";
--> statement-breakpoint
ALTER TABLE "task_completions" DROP CONSTRAINT "task_completions_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_list_id_lists_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_parent_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_item_tags" DROP CONSTRAINT "inbox_item_tags_inbox_item_id_inbox_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_item_tags" DROP CONSTRAINT "inbox_item_tags_tag_id_tags_id_fk";
--> statement-breakpoint
ALTER TABLE "tags" DROP CONSTRAINT "tags_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "task_tags" DROP CONSTRAINT "task_tags_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "task_tags" DROP CONSTRAINT "task_tags_tag_id_tags_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_assets" DROP CONSTRAINT "inbox_assets_inbox_item_id_inbox_items_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_assets" DROP CONSTRAINT "inbox_assets_attachment_id_attachments_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_converted_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "outcomes" DROP CONSTRAINT "outcomes_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_actions" DROP CONSTRAINT "agent_actions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_actions" DROP CONSTRAINT "agent_actions_job_id_agent_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_actions" DROP CONSTRAINT "agent_actions_execution_id_agent_executions_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_executions" DROP CONSTRAINT "agent_executions_job_id_agent_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_jobs" DROP CONSTRAINT "agent_jobs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_memory" DROP CONSTRAINT "agent_memory_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_usage" DROP CONSTRAINT "agent_usage_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_usage" DROP CONSTRAINT "agent_usage_job_id_agent_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_usage" DROP CONSTRAINT "agent_usage_execution_id_agent_executions_id_fk";
--> statement-breakpoint
ALTER TABLE "habits" DROP CONSTRAINT "habits_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "entity_links" DROP CONSTRAINT "entity_links_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_channels" DROP CONSTRAINT "notification_channels_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_outbox_id_notification_outbox_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_channel_id_notification_channels_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_outbox" DROP CONSTRAINT "notification_outbox_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "extension_auth_codes" DROP CONSTRAINT "extension_auth_codes_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "api_token_access_logs" DROP CONSTRAINT "api_token_access_logs_token_id_api_tokens_id_fk";
--> statement-breakpoint
ALTER TABLE "api_token_access_logs" DROP CONSTRAINT "api_token_access_logs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_model_budgets" DROP CONSTRAINT "agent_model_budgets_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_scheduling" DROP CONSTRAINT "agent_scheduling_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_memory_feedback" DROP CONSTRAINT "agent_memory_feedback_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_memory_history" DROP CONSTRAINT "agent_memory_history_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_memory_maintenance" DROP CONSTRAINT "agent_memory_maintenance_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_edit_events" DROP CONSTRAINT "agent_edit_events_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_edit_feedback" DROP CONSTRAINT "agent_edit_feedback_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_items" drop column "search_tsv";--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("inbox_items"."title", '')), 'A') || setweight(to_tsvector('simple', coalesce("inbox_items"."excerpt", '')), 'B')) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inbox_items_search_tsv" ON "inbox_items" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "idx_user_llm_providers_user" ON "user_llm_providers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_llm_routes_provider" ON "user_llm_routes" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "idx_inbox_assets_item" ON "inbox_assets" USING btree ("inbox_item_id");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "llm_providers";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "llm_routing";--> statement-breakpoint
ALTER TABLE "inbox_items" DROP COLUMN "extracted_text";--> statement-breakpoint
ALTER TABLE "inbox_items" DROP COLUMN "extracted_html";