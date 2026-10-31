ALTER TABLE "exploration_proposals" ALTER COLUMN "status" SET DATA TYPE varchar(32);
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "content" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "plan_id" char(36);
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "task_id" char(36);
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "place" varchar(128);
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "decision_deadline" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "departure_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "next_verify_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "rejected_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "confirmed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "exploration_proposals" ADD COLUMN "idempotency_key" varchar(128);
--> statement-breakpoint
CREATE UNIQUE INDEX "exploration_proposals_idempotency_uidx" ON "exploration_proposals" USING btree ("user_id","idempotency_key") WHERE "exploration_proposals"."idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_exploration_proposals_user_rejected" ON "exploration_proposals" USING btree ("user_id","activity_key","place","rejected_at");
--> statement-breakpoint
CREATE INDEX "idx_exploration_proposals_next_verify" ON "exploration_proposals" USING btree ("user_id","next_verify_at");
--> statement-breakpoint
ALTER TABLE "exploration_verifications" ADD COLUMN "field" varchar(64) DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "exploration_verifications" ADD COLUMN "value" jsonb;
--> statement-breakpoint
ALTER TABLE "exploration_verifications" ADD COLUMN "url" text;
--> statement-breakpoint
ALTER TABLE "exploration_verifications" ADD COLUMN "fetched_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "exploration_verifications" ADD COLUMN "valid_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "exploration_verifications" ADD COLUMN "status" varchar(16) DEFAULT 'unknown' NOT NULL;
--> statement-breakpoint
ALTER TABLE "exploration_verifications" ADD COLUMN "diff" jsonb;
--> statement-breakpoint
ALTER TABLE "exploration_verifications" ADD COLUMN "fingerprint" varchar(32);
--> statement-breakpoint
ALTER TABLE "exploration_verifications" ADD CONSTRAINT "exploration_verifications_status_check" CHECK ("exploration_verifications"."status" IN ('verified', 'unknown', 'changed'));
