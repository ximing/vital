# `@vital/server` — 服务端指令

## 这个目录负责什么

- 承载 Vital 的 HTTP API 服务（Fastify 5，默认端口 `3010`）与独立后台进程 `src/worker.ts`。
- 负责 PostgreSQL（Drizzle ORM）数据持久化、鉴权（Web Origin 下 Cookie + 其他端 Bearer / `vt_` 个人令牌）、文章抽取、S3 附件签名、通知投递、检索召回（Meilisearch / Qdrant）以及内置后台 Agent 调度与执行。

## 放置约束

- **放什么**：
  - `src/<domain>/<domain>.routes.ts`：Fastify 路由注册、入参/出参 Zod DTO 校验与 HTTP 状态码映射。
  - `src/<domain>/<domain>.service.ts`：业务领域逻辑、跨表事务、归属校验与级联清理。
  - `src/db/schema/`：Drizzle 表结构定义（严禁使用 `.references()` 外键），并统一从 `src/db/schema.ts` 导出。
  - `src/agent/`：后台 Agent 调度（`scheduler.ts` / `scheduling.ts`）、租约与任务执行（`jobs.ts` / `job-runtime.ts`）、记忆蒸馏与对话（`chat/`）。
  - `__tests__/`：按业务域组织的集成与单元测试，数据库清理统一维护在 `__tests__/helpers/db.ts`。
- **不放什么**：
  - 不要把前后端共享的请求/响应 Zod Schema 只写在服务端内部；共享契约应放在 `packages/dto`。
  - 不要在路由层（`*.routes.ts`）直接拼装多表 SQL 事务，复杂写入应下沉到 `*.service.ts`。
  - 不要在进程内存中维护 Agent 防抖、冷却、预算或待执行任务状态，所有调度状态必须落库 PostgreSQL。

## 开发偏好与局部范式

1. **服务层接管数据一致性**：
   - 写入引用 ID 前，必须先校验目标行存在且 `user_id` 属于当前用户。
   - 触及两张及以上表的写操作（父子表、关联表、outbox、历史记录、调度事件）必须包裹在同一个 `getDb().transaction` 中。
   - 硬删除父记录时必须在同一事务内清理或置空子记录；软删除（`deleted_at`）可保留子记录以支持恢复。
2. **Schema 与 Worker 同步**：
   - 修改 `src/db/schema/**` 后，通过 `pnpm --filter @vital/server migrate:generate` 生成迁移并执行 `migrate`。
   - **必须手动重启 `worker`**（`pnpm --filter @vital/server worker`）：API 的 `tsx watch` 会热重载，但 `worker` 不会自动重启，旧进程继续查询已删改列会导致调度与通知每轮报错。
3. **正文与私有附件**：
   - `inbox_item_bodies` 与 `inbox_items` 1:1 存储 `@vital/article-doc`（`content_json`）与 `extracted_text`，不存储原始 HTML；列表、同步与搜索接口不返回正文。
   - 含有私有图片或附件的业务 DTO 必须在服务端序列化时生成有效期 6 小时（`PRESIGN_GET_TTL_SECONDS=21600`）的 S3 签名 URL。
4. **外部 Skill 文档同步**：
   - 新增或修改路由、变更 DTO 字段后，在仓库根目录执行 `pnpm gen:vital-skill` 更新 `skills/vital/references/`。
