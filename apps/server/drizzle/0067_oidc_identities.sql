ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
--> statement-breakpoint
CREATE TABLE "oidc_identities" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"issuer" varchar(512) NOT NULL,
	"sub" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_identities_issuer_sub_uidx" ON "oidc_identities" USING btree ("issuer","sub");
--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_identities_user_issuer_uidx" ON "oidc_identities" USING btree ("user_id","issuer");
