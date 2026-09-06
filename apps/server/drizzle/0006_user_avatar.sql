ALTER TABLE "users" ADD COLUMN "avatar_attachment_id" char(36);

ALTER TABLE "attachments" DROP CONSTRAINT "attachments_owner_type_check";
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_type_check"
  CHECK ("owner_type" IN ('tmp', 'task', 'inbox', 'report', 'user'));
