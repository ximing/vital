CREATE TABLE "reports" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"type" varchar(16) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"title" varchar(200) NOT NULL,
	"body_md" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"snapshot_json" jsonb,
	"snapshot_at" timestamptz,
	"search_tsv" tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
		setweight(to_tsvector('simple', coalesce("body_md", '')), 'B')
	) STORED NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "reports_type_check" CHECK ("type" IN ('daily', 'weekly', 'monthly', 'yearly')),
	CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
	CONSTRAINT "reports_user_type_period_uidx" UNIQUE ("user_id", "type", "period_start")
);
--> statement-breakpoint
CREATE INDEX "idx_reports_user_updated" ON "reports" ("user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "idx_reports_search_tsv" ON "reports" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "idx_reports_title_trgm" ON "reports" USING gin ("title" gin_trgm_ops);
