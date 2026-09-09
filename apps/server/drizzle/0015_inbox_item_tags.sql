CREATE TABLE "inbox_item_tags" (
	"inbox_item_id" char(36) NOT NULL,
	"tag_id" char(36) NOT NULL,
	CONSTRAINT "inbox_item_tags_inbox_item_id_tag_id_pk" PRIMARY KEY ("inbox_item_id","tag_id"),
	CONSTRAINT "inbox_item_tags_inbox_item_id_inbox_items_id_fk" FOREIGN KEY ("inbox_item_id") REFERENCES "inbox_items"("id") ON DELETE CASCADE,
	CONSTRAINT "inbox_item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE
);
CREATE INDEX "idx_inbox_item_tags_tag" ON "inbox_item_tags" ("tag_id");
