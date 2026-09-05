CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"kind" varchar(16) DEFAULT 'user' NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" varchar(16),
	"icon" varchar(32),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "lists_kind_check" CHECK ("kind" IN ('user', 'inbox')),
	CONSTRAINT "lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lists_user_inbox_uidx" ON "lists" ("user_id") WHERE "kind" = 'inbox';
--> statement-breakpoint
CREATE INDEX "idx_lists_user_sort" ON "lists" ("user_id", "sort_order");
--> statement-breakpoint
INSERT INTO "lists" ("id", "user_id", "kind", "name", "sort_order", "is_archived", "created_at", "updated_at")
SELECT gen_random_uuid()::text, u."id", 'inbox', '收集箱', 0, false, now(), now()
FROM "users" u
WHERE NOT EXISTS (
	SELECT 1 FROM "lists" l WHERE l."user_id" = u."id" AND l."kind" = 'inbox'
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"list_id" char(36) NOT NULL,
	"parent_id" char(36),
	"title" varchar(500) NOT NULL,
	"notes_md" text DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'todo' NOT NULL,
	"priority" smallint DEFAULT 3 NOT NULL,
	"due_at" timestamptz,
	"start_at" timestamptz,
	"remind_at" timestamptz,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"time_bucket" varchar(16) DEFAULT 'anytime' NOT NULL,
	"recurrence_rrule" text,
	"recurrence_dtstart" timestamptz,
	"completed_at" timestamptz,
	"sort_order" bigint DEFAULT 0 NOT NULL,
	"deleted_at" timestamptz,
	"search_tsv" tsvector GENERATED ALWAYS AS (
		setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
		setweight(to_tsvector('simple', coalesce("notes_md", '')), 'B')
	) STORED NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status_check" CHECK ("status" IN ('todo', 'doing', 'done', 'canceled')),
	CONSTRAINT "tasks_priority_check" CHECK ("priority" BETWEEN 0 AND 3),
	CONSTRAINT "tasks_time_bucket_check" CHECK ("time_bucket" IN ('dated', 'anytime', 'someday')),
	CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
	CONSTRAINT "tasks_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "lists"("id") ON DELETE RESTRICT,
	CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "idx_tasks_user_list_sort" ON "tasks" ("user_id", "list_id", "sort_order");
--> statement-breakpoint
CREATE INDEX "idx_tasks_user_status_due" ON "tasks" ("user_id", "status", "due_at");
--> statement-breakpoint
CREATE INDEX "idx_tasks_user_updated" ON "tasks" ("user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "idx_tasks_search_tsv" ON "tasks" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX "idx_tasks_title_trgm" ON "tasks" USING gin ("title" gin_trgm_ops);
--> statement-breakpoint
CREATE TABLE "task_completions" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"task_id" char(36) NOT NULL,
	"occurrence_at" timestamptz NOT NULL,
	"completed_at" timestamptz NOT NULL,
	"due_was_null" boolean NOT NULL,
	CONSTRAINT "task_completions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
	CONSTRAINT "task_completions_task_occurrence_uidx" UNIQUE ("task_id", "occurrence_at")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"name" varchar(40) NOT NULL,
	"color" varchar(16),
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_lower_name_uidx" ON "tags" ("user_id", lower("name"));
--> statement-breakpoint
CREATE TABLE "task_tags" (
	"task_id" char(36) NOT NULL,
	"tag_id" char(36) NOT NULL,
	CONSTRAINT "task_tags_task_id_tag_id_pk" PRIMARY KEY ("task_id", "tag_id"),
	CONSTRAINT "task_tags_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
	CONSTRAINT "task_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE
);
