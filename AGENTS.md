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

Before a web/desktop release, bump `apps/web/package.json` `version`, then build. Vite inlines it as `VITE_APP_VERSION`; the settings footer shows that string. Do not hardcode the version in source — changing `package.json` after a build does not update the bundle.

<!-- agent-recall -->
## 记忆

本仓库的持久记忆由 agent-recall 接管。不要把决定、偏好或教训写进 `MEMORY.md`、`.claude/` 或本文件。密钥、令牌、私钥不要写入记忆。

项目名是 `vital`。没有 `AGENT_RECALL_PROJECT` 时用这个名字；设置了该变量时改用变量的值。`memory_save`、`memory_remember`、`memory_recall`、`memory_smart_search`、`memory_context`、`memory_lesson_save`、`memory_lesson_recall` 都要带这个 `project`。漏掉 `project` 的写入不会进本项目的开场注入。

开工前用 `memory_context` 取与当前任务相关的上下文。核对具体事实用 `memory_recall`，问题含糊用 `memory_smart_search`。只使用工具返回的内容。插件注入过的上下文可以接着用；工具调用观察不会自动回到以后的会话，值得留下的决定要自己写入。

要留下的内容用这些类型：`architecture` 架构与接口决定，`preference` 偏好，`workflow` 固定做法，`bug` 已确认的坑，`pattern` 反复出现的规律，`fact` 其他稳定事实，`lesson` 只通过 `memory_lesson_save` 写入。用户说记住时用 `memory_remember`，其余稳定结论用 `memory_save`。旧记录错了用 `memory_update`，不要并存一条相反的。用户要求删除时才 `memory_forget`。

临时笔记用 `memory_sketch_create`（约 24 小时），确认要留再 `memory_sketch_promote`。有 `memory_next` 时，开工先看未完成行动。当前档位没有的工具跳过，不要改 MCP 配置来凑工具。
<!-- /agent-recall -->
