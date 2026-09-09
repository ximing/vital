ALTER TABLE "users" ADD COLUMN "llm_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL;
