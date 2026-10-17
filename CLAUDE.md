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

<!-- agent-recall -->
## 记忆

本仓库的持久记忆由 agent-recall 接管。不要把决定、偏好或教训写进 `MEMORY.md`、`.claude/` 或本文件。密钥、令牌、私钥不要写入记忆。

项目名是 `vital`。没有 `AGENT_RECALL_PROJECT` 时用这个名字；设置了该变量时改用变量的值。`memory_save`、`memory_remember`、`memory_recall`、`memory_smart_search`、`memory_context`、`memory_lesson_save`、`memory_lesson_recall` 都要带这个 `project`。漏掉 `project` 的写入不会进本项目的开场注入。

开工前用 `memory_context` 取与当前任务相关的上下文。核对具体事实用 `memory_recall`，问题含糊用 `memory_smart_search`。只使用工具返回的内容。插件注入过的上下文可以接着用；工具调用观察不会自动回到以后的会话，值得留下的决定要自己写入。

要留下的内容用这些类型：`architecture` 架构与接口决定，`preference` 偏好，`workflow` 固定做法，`bug` 已确认的坑，`pattern` 反复出现的规律，`fact` 其他稳定事实，`lesson` 只通过 `memory_lesson_save` 写入。用户说记住时用 `memory_remember`，其余稳定结论用 `memory_save`。旧记录错了用 `memory_update`，不要并存一条相反的。用户要求删除时才 `memory_forget`。

临时笔记用 `memory_sketch_create`（约 24 小时），确认要留再 `memory_sketch_promote`。有 `memory_next` 时，开工先看未完成行动。当前档位没有的工具跳过，不要改 MCP 配置来凑工具。
<!-- /agent-recall -->
