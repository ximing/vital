CREATE TABLE "continuity_dependencies" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"contract_id" char(36) NOT NULL,
	"blocked_type" varchar(16) NOT NULL,
	"blocked_id" char(36) NOT NULL,
	"prerequisite_type" varchar(16) NOT NULL,
	"prerequisite_id" char(36),
	"external_label" text,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"last_user_update_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_dependencies_blocked_type_check" CHECK ("continuity_dependencies"."blocked_type" IN ('task', 'outcome')),
	CONSTRAINT "continuity_dependencies_prereq_type_check" CHECK ("continuity_dependencies"."prerequisite_type" IN ('task', 'outcome', 'external')),
	CONSTRAINT "continuity_dependencies_status_check" CHECK ("continuity_dependencies"."status" IN ('open', 'resolved', 'canceled')),
	CONSTRAINT "continuity_dependencies_prereq_id_check" CHECK (("continuity_dependencies"."prerequisite_type" = 'external' AND "continuity_dependencies"."prerequisite_id" IS NULL) OR ("continuity_dependencies"."prerequisite_type" <> 'external' AND "continuity_dependencies"."prerequisite_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "idx_continuity_dependencies_user_contract" ON "continuity_dependencies" USING btree ("user_id","contract_id");
--> statement-breakpoint
CREATE INDEX "idx_continuity_dependencies_prereq" ON "continuity_dependencies" USING btree ("user_id","prerequisite_type","prerequisite_id");
--> statement-breakpoint
CREATE TABLE "continuity_protected_blocks" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"label" varchar(120) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"weekday" smallint,
	"start_hm" varchar(5),
	"end_hm" varchar(5),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "continuity_protected_blocks_kind_check" CHECK ("continuity_protected_blocks"."kind" IN ('once', 'weekly')),
	CONSTRAINT "continuity_protected_blocks_shape_check" CHECK (("continuity_protected_blocks"."kind" = 'once' AND "continuity_protected_blocks"."start_at" IS NOT NULL AND "continuity_protected_blocks"."end_at" IS NOT NULL) OR ("continuity_protected_blocks"."kind" = 'weekly' AND "continuity_protected_blocks"."weekday" IS NOT NULL AND "continuity_protected_blocks"."start_hm" IS NOT NULL AND "continuity_protected_blocks"."end_hm" IS NOT NULL)),
	CONSTRAINT "continuity_protected_blocks_weekday_check" CHECK ("continuity_protected_blocks"."weekday" IS NULL OR "continuity_protected_blocks"."weekday" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE INDEX "idx_continuity_protected_blocks_user" ON "continuity_protected_blocks" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "split_allowed" boolean DEFAULT false NOT NULL;
