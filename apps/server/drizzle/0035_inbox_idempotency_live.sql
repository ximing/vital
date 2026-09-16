DROP INDEX IF EXISTS "inbox_items_user_idempotency_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_user_idempotency_uidx" ON "inbox_items" ("user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL AND "deleted_at" IS NULL;
