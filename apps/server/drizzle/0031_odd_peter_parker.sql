CREATE INDEX "idx_refresh_tokens_expires" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_attachments_status_created" ON "attachments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_parent" ON "tasks" USING btree ("user_id","parent_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_habit" ON "tasks" USING btree ("user_id","habit_id") WHERE "tasks"."habit_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_tasks_live_status_due" ON "tasks" USING btree ("user_id","status","due_at") WHERE "tasks"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_inbox_item_tags_tag" ON "inbox_item_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_task_tags_tag" ON "task_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "idx_inbox_items_user_status_captured" ON "inbox_items" USING btree ("user_id","status","captured_at");--> statement-breakpoint
CREATE INDEX "idx_inbox_items_user_outcome" ON "inbox_items" USING btree ("user_id","outcome_id");--> statement-breakpoint
CREATE INDEX "idx_inbox_items_live_captured" ON "inbox_items" USING btree ("user_id","captured_at") WHERE "inbox_items"."deleted_at" IS NULL;