ALTER TABLE "users" ADD COLUMN "llm_api_base" varchar(512);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "llm_api_key" varchar(1024);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "llm_model" varchar(128);
