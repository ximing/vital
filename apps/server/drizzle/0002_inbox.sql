CREATE TABLE "inbox_items" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"title" varchar(500) NOT NULL,
	"original_url" text,
	"canonical_url" text,
	"extracted_text" text,
	"extracted_html" text,
	"excerpt" varchar(500),
	"byline" varchar(200),
	"site_name" varchar(200),
	"status" varchar(16) DEFAULT 'unread' NOT NULL,
	"source" varchar(16) DEFAULT 'manual' NOT NULL,
	"captured_at" timestamptz DEFAULT now() NOT NULL,
	"read_at" timestamptz,
	"idempotency_key" char(64),
	"idempotency_response" jsonb,
	"converted_task_id" char(36),
	"deleted_at" timestamptz,
	"search_tsv" tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
		setweight(to_tsvector('simple', coalesce("excerpt", '')), 'B') ||
		setweight(to_tsvector('simple', coalesce("extracted_text", '')), 'C')
	) STORED NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_items_status_check" CHECK ("status" IN ('unread', 'later', 'archived', 'converted')),
	CONSTRAINT "inbox_items_source_check" CHECK ("source" IN ('extension', 'web', 'mobile', 'manual')),
	CONSTRAINT "inbox_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
	CONSTRAINT "inbox_items_converted_task_id_tasks_id_fk" FOREIGN KEY ("converted_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_user_idempotency_uidx" ON "inbox_items" ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_inbox_items_user_captured" ON "inbox_items" ("user_id", "captured_at");
--> statement-breakpoint
CREATE INDEX "idx_inbox_items_search_tsv" ON "inbox_items" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "idx_inbox_items_title_trgm" ON "inbox_items" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE TABLE "inbox_assets" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"inbox_item_id" char(36) NOT NULL,
	"attachment_id" char(36) NOT NULL,
	"original_src" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inbox_assets_item_attachment_uidx" UNIQUE ("inbox_item_id", "attachment_id"),
	CONSTRAINT "inbox_assets_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "inbox_items"("id") ON DELETE CASCADE,
	CONSTRAINT "inbox_assets_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "entity_links" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"from_type" varchar(16) NOT NULL,
	"from_id" char(36) NOT NULL,
	"to_type" varchar(16) NOT NULL,
	"to_id" char(36) NOT NULL,
	"role" varchar(16) NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "entity_links_pair_role_uidx" UNIQUE ("from_type", "from_id", "to_type", "to_id", "role"),
	CONSTRAINT "entity_links_from_type_check" CHECK ("from_type" IN ('task', 'inbox', 'report')),
	CONSTRAINT "entity_links_to_type_check" CHECK ("to_type" IN ('task', 'inbox', 'report')),
	CONSTRAINT "entity_links_role_check" CHECK ("role" IN ('embeds', 'converted_from', 'mentioned')),
	CONSTRAINT "entity_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "idx_entity_links_to" ON "entity_links" ("to_type", "to_id");
--> statement-breakpoint
CREATE INDEX "idx_entity_links_from" ON "entity_links" ("from_type", "from_id");
