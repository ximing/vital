ALTER TABLE "lists" ADD COLUMN "parent_id" char(36);
ALTER TABLE "lists" ADD COLUMN "icon_attachment_id" char(36);
ALTER TABLE "lists" ADD CONSTRAINT "lists_parent_id_lists_id_fk" FOREIGN KEY ("parent_id") REFERENCES "lists"("id") ON DELETE SET NULL;
CREATE INDEX "idx_lists_user_parent_sort" ON "lists" ("user_id", "parent_id", "sort_order");

ALTER TABLE "attachments" DROP CONSTRAINT "attachments_owner_type_check";
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_type_check"
  CHECK ("owner_type" IN ('tmp', 'task', 'inbox', 'report', 'user', 'list'));
