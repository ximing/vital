CREATE TABLE "user_inwit_config" (
	"user_id" char(36) PRIMARY KEY NOT NULL,
	"base_url" varchar(512) NOT NULL,
	"access_key_enc" text NOT NULL,
	"default_topic_id" char(36),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "inwit_document_id" char(36);--> statement-breakpoint
ALTER TABLE "inbox_items" ADD COLUMN "inwit_exported_at" timestamp with time zone;
