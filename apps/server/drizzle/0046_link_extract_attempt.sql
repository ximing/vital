ALTER TABLE "inbox_items" ADD COLUMN "link_extract_attempted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_inbox_items_link_extract_attempt" ON "inbox_items" USING btree ("captured_at","id") WHERE "inbox_items"."link_extract_attempted_at" IS NULL AND "inbox_items"."deleted_at" IS NULL AND "inbox_items"."original_url" IS NOT NULL;
