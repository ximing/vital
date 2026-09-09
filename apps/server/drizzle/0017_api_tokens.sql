CREATE TABLE "api_tokens" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"name" varchar(50) NOT NULL,
	"token_prefix" varchar(16) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"last_used_at" timestamptz,
	"revoked_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "idx_api_tokens_user" ON "api_tokens" ("user_id");
--> statement-breakpoint
CREATE TABLE "api_token_access_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token_id" char(36) NOT NULL,
	"user_id" char(36) NOT NULL,
	"method" varchar(8) NOT NULL,
	"path" varchar(512) NOT NULL,
	"status" smallint NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(255),
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "api_token_access_logs_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "api_tokens"("id") ON DELETE CASCADE,
	CONSTRAINT "api_token_access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "idx_api_token_access_logs_token_created" ON "api_token_access_logs" ("token_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_api_token_access_logs_created" ON "api_token_access_logs" ("created_at");
