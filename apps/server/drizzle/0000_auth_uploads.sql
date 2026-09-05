CREATE TABLE "users" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"display_name" varchar(50) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
	"locale" varchar(16) DEFAULT 'zh-CN' NOT NULL,
	"theme_preference" varchar(16) DEFAULT 'system' NOT NULL,
	"week_starts_on" smallint DEFAULT 1 NOT NULL,
	"convert_archive_on_complete" boolean DEFAULT false NOT NULL,
	"onboarding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"password_changed_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_theme_preference_check" CHECK ("theme_preference" IN ('light', 'dark', 'system')),
	CONSTRAINT "users_week_starts_on_check" CHECK ("week_starts_on" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"auth_mode" varchar(16) NOT NULL,
	"device_info" varchar(255),
	"expires_at" timestamptz NOT NULL,
	"revoked_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "refresh_tokens_auth_mode_check" CHECK ("auth_mode" IN ('cookie', 'bearer')),
	CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" ("user_id");
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"owner_type" varchar(16) DEFAULT 'tmp' NOT NULL,
	"owner_id" char(36),
	"s3_key" varchar(512) NOT NULL,
	"mime" varchar(100) NOT NULL,
	"size" bigint NOT NULL,
	"width" integer,
	"height" integer,
	"status" varchar(16) DEFAULT 'uploading' NOT NULL,
	"storage_meta" jsonb NOT NULL,
	"upload_id" varchar(128),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"orphaned_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_owner_type_check" CHECK ("owner_type" IN ('tmp', 'task', 'inbox', 'report')),
	CONSTRAINT "attachments_status_check" CHECK ("status" IN ('uploading', 'ready', 'orphaned')),
	CONSTRAINT "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "idx_attachments_user" ON "attachments" ("user_id");
--> statement-breakpoint
CREATE INDEX "idx_attachments_owner" ON "attachments" ("owner_type", "owner_id");
