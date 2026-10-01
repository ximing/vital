ALTER TABLE "user_llm_routes" DROP CONSTRAINT "user_llm_routes_capability_check";
--> statement-breakpoint
ALTER TABLE "user_llm_routes" ADD CONSTRAINT "user_llm_routes_capability_check" CHECK ("user_llm_routes"."capability" IN ('default', 'task.parse', 'agent.headline', 'agent.cluster', 'agent.decompose', 'agent.draft', 'agent.report', 'agent.reflect', 'agent.distill', 'agent.notify', 'agent.critic', 'agent.chat'));
--> statement-breakpoint
CREATE TABLE "agent_chat_conversations" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_chat_conversations_status_check" CHECK ("agent_chat_conversations"."status" IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_chat_conversations_active_uidx" ON "agent_chat_conversations" USING btree ("user_id") WHERE "agent_chat_conversations"."status" = 'active';
--> statement-breakpoint
CREATE TABLE "agent_chat_messages" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"conversation_id" char(36) NOT NULL,
	"role" varchar(16) NOT NULL,
	"text" text NOT NULL,
	"tool_name" varchar(64),
	"tool_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_chat_messages_role_check" CHECK ("agent_chat_messages"."role" IN ('user', 'assistant', 'tool'))
);
--> statement-breakpoint
CREATE INDEX "idx_agent_chat_messages_conv" ON "agent_chat_messages" USING btree ("user_id","conversation_id","created_at");
--> statement-breakpoint
CREATE TABLE "agent_chat_previews" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"conversation_id" char(36) NOT NULL,
	"tool_name" varchar(64) NOT NULL,
	"args" jsonb NOT NULL,
	"summary" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_chat_previews_status_check" CHECK ("agent_chat_previews"."status" IN ('open', 'applied', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE INDEX "idx_agent_chat_previews_user" ON "agent_chat_previews" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE TABLE "agent_chat_budgets" (
	"user_id" char(36) NOT NULL,
	"day" date NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_chat_budgets_pkey" PRIMARY KEY("user_id","day")
);
