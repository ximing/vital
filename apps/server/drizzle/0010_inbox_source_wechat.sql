ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_source_check";
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_source_check" CHECK ("source" IN ('extension', 'wechat', 'web', 'mobile', 'manual'));
