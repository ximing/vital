ALTER TABLE "habits" ADD COLUMN "outcome_id" char(36);--> statement-breakpoint
CREATE INDEX "idx_habits_user_outcome" ON "habits" USING btree ("user_id","outcome_id");