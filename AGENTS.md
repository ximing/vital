# Vital — agent notes

Monorepo for a single-user personal OS (inbox → todos → reports). Server is Fastify 5 + Drizzle + PostgreSQL.

## Database: no foreign keys

PostgreSQL tables **do not use foreign keys**. `user_id` / `*_id` columns are plain `char(36)`. Ownership, existence, and cascade cleanup are enforced in the service layer.

When you add or change a write path:

- Assert the referenced row exists and `user_id` matches before insert/update.
- Any operation that touches more than one table (parent + children, join rows, outbox, history) **must run in a single `getDb().transaction`**. There is no engine-level `ON DELETE CASCADE` / `SET NULL` to fall back on.
- Hard-delete of a parent must explicitly delete or null children in that same transaction. Soft-delete (`deleted_at`) can leave children; restore must still see them.
- Tests: `resetDb()` deletes every table explicitly. New tables go on that list.
- After a schema change, **restart the worker** (`pnpm --filter @vital/server worker`). API `tsx watch` reloads; the worker process does not.

Typical parent → child cleanup (same transaction):

| Delete | Also in the same transaction |
|---|---|
| tag | `task_tags`, `inbox_item_tags` |
| notification channel | `notification_deliveries` |
| habit | soft-delete open task instances, null `habit_id` / `habit_key` on remaining rows |
| LLM provider | `user_llm_routes` pointing at that provider |
| agent-created outcome (undo) | null `outcome_id` on tasks / inbox / habits |
| user (tests / eval only) | every table that stores `user_id` |

`inbox_item_bodies` is 1:1 with `inbox_items` and stores the article body as an article-doc JSON (`content_json`, `@vital/article-doc`) plus plain `extracted_text` — no HTML is stored. List/sync/search omit the body; `GET /inbox/:id` and create/patch load it. Do not let a body-less sync payload overwrite a cached full item (see `coalesceInboxBody`).

## Other

Engineering conventions: `docs/project-standards.md`.
