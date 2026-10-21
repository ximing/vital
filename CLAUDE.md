# Vital — 项目指令

## 项目概览

Vital 是单用户、中文优先（`zh-CN`）、AI First 的个人操作系统（Inbox 收集 → Todos 执行 → Reports 复盘），采用 pnpm workspace + Turbo 构建（Node ≥ 22）。

- `apps/server`：Fastify 5 + Drizzle + PostgreSQL 后端 API（端口 `3010`）与后台 `worker`（Agent 调度、通知派发、正文抽取）
- `apps/web`：Vite + React 19 + Tailwind v4 + `@rabjs/react` 工作区（端口 `5180`）
- `apps/desktop`：Tauri 2 桌面端外壳（直接承载 `apps/web`）
- `apps/mobile`：Expo + React Native 移动端（Bearer 鉴权 + 增量同步）
- `apps/extension`：Chrome MV3 / WXT 浏览器收集扩展
- `packages/dto`：前后端共享的 Zod DTO 与复盘模板
- `packages/api-client`：面向各端复用的类型化 API Client 与同步合并工具
- `packages/tokens`：Emerald Garden 设计系统 Token（`theme.ts` 与 `css/semantic.css`）
- `packages/article-doc` / `article-extract` / `article-html` / `markdown`：正文文档结构、抽取与 Markdown 渲染
- `skills/vital`：供外部 Agent 通过 HTTP API 操作 Vital 数据的内置 Skill

## 全局基线规则

1. **数据库无外键**：PostgreSQL 表之间**不建外键**（禁止在 Drizzle schema 中使用 `.references()`）。归属校验（`user_id`）、存在性检查与父子级联清理均在服务层完成；跨表写入必须在同一个 `getDb().transaction` 中执行。
2. **收集箱正文隔离**：文章正文存储在 `inbox_item_bodies`（`@vital/article-doc` JSON + `extracted_text`，不存 HTML）。列表、同步与搜索响应省略正文；客户端合并同步数据时必须使用 `coalesceInboxBody`，防止冲掉已缓存的阅读器正文。
3. **私有附件安全渲染**：所有可展示的私有图片/附件均由服务端在 DTO 序列化时生成 6 小时有效的 S3 签名 URL。客户端只能直接渲染 DTO 返回的签名 URL，禁止直连 `/api/v1/uploads/:id` 或下载 Blob 绕过鉴权，加载失败必须回退到本地占位。
4. **设计 Token 唯一事实源**：视觉规范遵循 Emerald Garden 设计系统（详见 `docs/vital-calm-productivity-design-system.md`），修改 Token 必须同步更新 `packages/tokens/src/theme.ts` 与 `packages/tokens/src/css/semantic.css`。
5. **工程与发版规范**：详细工程约定见 `docs/project-standards.md`。发布 Web / 桌面前必须先 bump `apps/web/package.json` 的 `version` 再执行构建；修改路由或 `@vital/dto` 后必须运行 `pnpm gen:vital-skill` 同步更新 `skills/vital/references/`。

## 常用开发入口

- 一键本地启动（迁移 + API `:3010` + worker + Web `:5180`）：`./dev.sh`
- 全局检查：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`
- 重新生成外部 Vital Skill API 参考：`pnpm gen:vital-skill`
- 数据库迁移与后台进程：`pnpm --filter @vital/server migrate`、`pnpm --filter @vital/server worker`（修改 schema 后必须手动重启 worker）

## 局部规则与路径规则导航

进入具体子系统或改动特定文件时，按需加载以下规则：

### 子系统级 `CLAUDE.md`
- `apps/server/CLAUDE.md`：服务端分层、无外键事务与级联删除映射、后台 Worker 与 Agent 调度、S3 签名 URL
- `apps/web/CLAUDE.md`：Web 工作区布局（Rail / Library / Canvas）、`@rabjs/react` 服务与 Query 协作、发版版本号
- `apps/mobile/CLAUDE.md`：Expo Router 路由与领域目录边界、Token 颜色硬编码禁令、增量同步合并
- `apps/extension/CLAUDE.md`：WXT 扩展入口、正文抽取链路与一次性授权码鉴权

### 横切路径规则（`.claude/rules/*.md`）
- `.claude/rules/database-and-schema.md`：Drizzle Schema、跨表事务与级联清理、迁移与 `resetDb()` 维护
- `.claude/rules/api-contracts.md`：`@vital/dto`、API 路由、附件签名字段与 `skills/vital` 同步
- `.claude/rules/design-tokens-and-ui.md`：Emerald Garden 视觉约束、Token 双改、表单控件复用与图片占位
- `.claude/rules/testing.md`：`vital_test` 测试数据库规范、数据清理与各端 Vitest 约定

<!-- agent-recall -->
## 记忆

本仓库的持久记忆由 agent-recall 接管。不要把决定、偏好或教训写进 `MEMORY.md`、`.claude/` 或本文件。密钥、令牌、私钥不要写入记忆。

项目名是 `vital`。没有 `AGENT_RECALL_PROJECT` 时用这个名字；设置了该变量时改用变量的值。`memory_save`、`memory_remember`、`memory_recall`、`memory_smart_search`、`memory_context`、`memory_lesson_save`、`memory_lesson_recall` 都要带这个 `project`。漏掉 `project` 的写入不会进本项目的开场注入。

开工前用 `memory_context` 取与当前任务相关的上下文。核对具体事实用 `memory_recall`，问题含糊用 `memory_smart_search`。只使用工具返回的内容。插件注入过的上下文可以接着用；工具调用观察不会自动回到以后的会话，值得留下的决定要自己写入。

要留下的内容用这些类型：`architecture` 架构与接口决定，`preference` 偏好，`workflow` 固定做法，`bug` 已确认的坑，`pattern` 反复出现的规律，`fact` 其他稳定事实，`lesson` 只通过 `memory_lesson_save` 写入。用户说记住时用 `memory_remember`，其余稳定结论用 `memory_save`。旧记录错了用 `memory_update`，不要并存一条相反的。用户要求删除时才 `memory_forget`。

临时笔记用 `memory_sketch_create`（约 24 小时），确认要留再 `memory_sketch_promote`。有 `memory_next` 时，开工先看未完成行动。当前档位没有的工具跳过，不要改 MCP 配置来凑工具。
<!-- /agent-recall -->
