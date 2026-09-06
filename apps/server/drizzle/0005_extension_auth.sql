CREATE TABLE "extension_auth_codes" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"code_hash" char(64) NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"used_at" timestamptz,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "extension_auth_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "extension_auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "idx_extension_auth_codes_expires" ON "extension_auth_codes" ("expires_at");
