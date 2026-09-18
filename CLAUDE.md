# Vital — Claude Code notes

Same product and layout as `AGENTS.md`. Read that file first.

## Database: no foreign keys

Tables have **no PostgreSQL foreign keys**. Do not add `.references()` in Drizzle schema. Service code owns:

1. Cross-user / existence checks on every write that stores an id.
2. Multi-table writes in **one transaction**. Cascades will not happen in the database.
3. Explicit child cleanup on hard-delete (join tables, deliveries, habit instances, LLM routes, outcome links). Soft-delete does not require wiping children.
4. `resetDb()` / eval fixture user wipe must list new tables; they will not disappear via `ON DELETE CASCADE`.

After editing `apps/server/src/db/schema/**`, restart the **worker** as well as relying on API `tsx watch`. A live worker that still `SELECT`s dropped columns (`llm_providers`, …) will fail the agent scheduler and notification dispatch on every tick.

Inbox article body lives in `inbox_item_bodies` as an article-doc JSON (`content_json`, from `@vital/article-doc`) plus plain `extracted_text` — there is no stored HTML. Sync payloads omit the body; merge with `coalesceInboxBody` so a list/sync row cannot blank the reader cache.

Engineering conventions: `docs/project-standards.md`.

Before a web/desktop release, bump `apps/web/package.json` `version`, then build. Vite inlines it as `VITE_APP_VERSION`; the settings footer shows that string. Do not hardcode the version in source — changing `package.json` after a build does not update the bundle.
