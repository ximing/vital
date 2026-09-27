CREATE TABLE "push_devices" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"user_id" char(36) NOT NULL,
	"provider" varchar(16) NOT NULL,
	"token" varchar(512) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_provider_check" CHECK ("provider" IN ('huawei')),
	CONSTRAINT "push_devices_provider_token_uidx" UNIQUE("provider","token")
);--> statement-breakpoint
CREATE INDEX "idx_push_devices_user" ON "push_devices" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE "push_deliveries" (
	"id" char(36) PRIMARY KEY NOT NULL,
	"outbox_id" char(36) NOT NULL,
	"device_id" char(36) NOT NULL,
	"status" varchar(16) NOT NULL,
	"permanent" boolean DEFAULT false NOT NULL,
	"last_error" varchar(500),
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_deliveries_status_check" CHECK ("status" IN ('sent', 'failed')),
	CONSTRAINT "push_deliveries_outbox_device_uidx" UNIQUE("outbox_id","device_id")
);--> statement-breakpoint
CREATE INDEX "idx_push_deliveries_outbox" ON "push_deliveries" USING btree ("outbox_id");
