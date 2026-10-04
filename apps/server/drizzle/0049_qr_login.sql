CREATE TABLE "qr_login_tickets" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"secret_hash" char(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"user_id" char(36),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_login_tickets_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "qr_login_tickets_status_check" CHECK ("status" IN ('pending', 'scanned', 'confirmed', 'consumed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX "idx_qr_login_tickets_expires" ON "qr_login_tickets" ("expires_at");
