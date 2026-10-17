CREATE TABLE "energy_logs" (
  "id" char(36) PRIMARY KEY NOT NULL,
  "user_id" char(36) NOT NULL,
  "energy" smallint NOT NULL,
  "mood" text,
  "note" text,
  "logged_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "energy_logs_energy_check" CHECK ("energy" BETWEEN 1 AND 5)
);--> statement-breakpoint
CREATE INDEX "idx_energy_logs_user_logged" ON "energy_logs" ("user_id", "logged_at");--> statement-breakpoint
CREATE INDEX "idx_energy_logs_user_created" ON "energy_logs" ("user_id", "created_at");
