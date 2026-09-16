CREATE TABLE "inbox_idempotency_responses" (
	"inbox_item_id" char(36) PRIMARY KEY NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "inbox_idempotency_responses" ("inbox_item_id", "response")
SELECT "id", "idempotency_response" FROM "inbox_items" WHERE "idempotency_response" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_items" DROP COLUMN "idempotency_response";
