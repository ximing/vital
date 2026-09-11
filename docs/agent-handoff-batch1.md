# Handoff：提案采纳事务化 + 用户编辑事件流（第一批）

你是接手 vital 项目本轮开发的实现 Agent。本文档是唯一需求来源，按顺序执行。
项目根目录：`/Users/ximing/project/mygithub/vital`（pnpm monorepo，server 为 Fastify + Drizzle，web 为 React）。

## 背景（为什么做这两件事）

vital 正在向"自进化 Agent"演进，闭环是：Agent 提案 → 用户反馈 → 记忆蒸馏 → 影响下一轮提案。
本轮补两块地基：

- **任务 A**：提案采纳目前由前端逐个创建子任务，中途失败 = 半个拆解落地，重复点击 = 重复子任务。改为服务端单事务物化，并记录落地实体 ID，实现 `task.decompose` 的可回滚（undo）。
- **任务 B**：用户在非 Agent 界面的自然编辑（改标题、改截止、挪线程）目前对蒸馏完全不可见——这是最真实的纠偏信号。建一条编辑事件流，供 `memory.distill` 消费。

## 开始前必读

1. 项目记忆（前几轮的坑都在里面，务必先读）：
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-csi-verification.md`（csi 验收实操）
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-v13-status.md`（csi 前确认 worker 是新代码）
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-retrieval-status.md`（dev 库手动 migrate）
2. 本仓库有 CodeGraph 索引（`.codegraph/`），定位代码优先用 `codegraph explore` 或 codegraph MCP 工具，再考虑 grep/Read。
3. 工作区有大量**未提交**的改动（上一轮检索建设），不要动它们，也不要 commit/push 任何东西。

## 现状锚点（已核实，从这里开始读代码）

| 锚点 | 现状 |
|---|---|
| `apps/web/src/features/today/DecomposeBanner.tsx:32-52` | `accept()` 前端循环 `client.createTask` 建子任务，再发 `sendAgentActionFeedback('accepted')` |
| `apps/server/src/agent/actions.service.ts:150-225` | `applyActionFeedback`：事务 + `lockAgentUser`，非 pending 返回 409；`task.draft` 的 accepted 已有服务端物化（追加 notes）；**`task.decompose` 的 accepted 只记账**（146 行注释自己承认） |
| `apps/server/src/agent/agent.routes.ts:62` | `POST /api/v1/agent/actions/:id/feedback` 路由 |
| `packages/dto/src/agent.ts:19,42-46` | `agentFeedbackSchema = ['pending','accepted','edited','dismissed']`；`actionFeedbackInputSchema` |
| `apps/server/src/agent/scheduler.ts:34-45` | memory.distill 的观察条件：查 `agent_actions` 未消费反馈，用 `NOT EXISTS agent_memory_feedback` + md5 指纹防重 |
| `apps/server/src/db/schema/agent-memory-history.ts` | `agent_memory_feedback` 防重表（userId+actionId+version 主键）——任务 B 照这个模式建表 |
| `apps/server/src/agent/processors.ts:635` | `processMemoryDistill`：从 `agent_actions` 读反馈喂给蒸馏 prompt |
| `apps/server/src/agent/prompts.ts:224-277` | `DistillActionFact` / `buildDistillPrompt`——任务 B 要扩展输入 |
| `apps/server/drizzle/` | 最新迁移是 `0027_light_machine_man.sql`，新迁移编号从 0028 开始 |

## 任务 A：提案采纳服务端事务化 + undo

### A1 服务端物化

推荐方案（如你有更强的理由可改，须在计划里说明）：**不新增 accept 端点**，而是在 `applyActionFeedback` 的事务内为 `feedback === 'accepted' && actionType === 'task.decompose'` 增加物化分支（与现有 `task.draft` 分支同构）：

- 事务内（`lockAgentUser` 之后）按 `payload.subtasks` 逐条创建子任务：继承 `listId`、`parentId = targetId`、`outcomeId`、`estimateMinutes`。
- **sortOrder 陷阱**：前端原行为走 `client.createTask` → `tasks.service.ts:440` 自动算 `sortOrder: await nextSortOrder(listId, parentId)`。事务内裸 insert 绕过这一层会丢排序。`nextSortOrder` 目前用 `getDb()` 不接收 tx——把它改为可传入 tx（或提取等价逻辑），物化必须复用它，不要手写排序值。
- 把创建的子任务 ID 写入 `feedbackPayload`，统一形状：`{ materialized: { taskIds: string[] } }`。这是将来所有 actionType 通用补偿记录的接口形状。
- 幂等保持现有语义：`feedback !== 'pending'` → 409，事务内 `WHERE feedback = 'pending'` 的条件更新兜底。

### A2 undo 端点

新增 `POST /api/v1/agent/actions/:id/undo`：

- 前置条件：`feedback === 'accepted'` 且 `feedbackPayload.materialized.taskIds` 存在，否则 404/409。
- 事务内：校验所有 materialized 子任务仍存在、未被完成、未软删（任一不满足 → 409，错误信息说明原因）；全部软删（`deletedAt`）；`agentActions.feedback` 改为 `'undone'`，`feedbackAt` 刷新，保留 `materialized` 记录。
- `agentFeedbackSchema` 增加 `'undone'`（zod + DB 约束 + drizzle 迁移，先查 `apps/server/src/db/schema/agent.ts:80` 附近 feedback 列怎么约束的）。undo 是蒸馏要看到的强信号，必须是终态而不是塞在 payload 里的标志。
- **枚举涟漪（已核实，必须处理）**：
  - `apps/web/src/copy.ts:191` 的 feedback 标签映射只有 4 个值，加 `'undone': '已撤销'`，否则活动记录渲染 undefined；
  - `apps/server/src/agent/metrics.service.ts:45` 采纳率统计 `feedback in ('accepted','edited')`——`'undone'` 天然落出 adopted（行为正确，无需改 adopted），但请在同文件加一个 `undone` 独立计数桶（撤销率，第二批评估体系的输入指标，现在只值一行 SQL）。
- undo 后同样 `markAgentSchedule(tx, userId, 'memory.distill', { now, urgent: true })`。

### A3 前端改造

- `DecomposeBanner.accept()` 删掉 createTask 循环，只发一次 `sendAgentActionFeedback(action.id, { feedback: 'accepted' })`，成功后 invalidate `todoKeys.all` / `todayKeys.all`。
- `packages/api-client` 增加对应 undo 方法；**api-client 改动后要重新 build**（项目记忆的坑）。
- 检查 web 测试：`apps/web/__tests__/features/todos/task-detail-*.test.tsx` 覆盖了 DecomposeBanner，随行为更新。

## 任务 B：用户编辑事件流

### B1 采集

新表 `agent_edit_events`（drizzle 迁移 0028，照 `agent_memory_feedback` 的风格）：

- 一行一次编辑事件：`id, userId, entityType('task'|'outcome'), entityId, fields jsonb`（`[{field, before, after}]` 数组）, `source`（预留，先恒 `'user'`）, `createdAt`。
- 采集点放在 **service 层的 update 函数**（`tasks.service` / `outcomes.service` 的用户更新路径）。Agent 的写库（`processors.ts` 直接 `tx.update`、`applyActionFeedback` 的 edited 分支）不经过这些函数，天然隔离——**用测试锁死这一点**（agent 写 headline / draft 追加 notes 不得产生事件）。
- 只记有学习价值的字段：
  - task：`title`、`dueAt`、`priority`、`estimateMinutes`、`outcomeId`（挪线程）
  - outcome：`name`
  - 不记 `notesMd`（噪声大）、不记纯 `updatedAt` 变化的空编辑。
- before/after 存摘要值（标题截断到 ~120 字符，时间存 ISO），不存整行。

### B2 蒸馏消费

- `scheduler.ts` 中 memory.distill 的观察条件扩展：除了 `agent_actions` 未消费反馈，把未消费的 `agent_edit_events` 也纳入（数量 > 0 即触发 mark）。
- 防重新表 `agent_edit_feedback`（userId+eventId 主键即可——编辑事件是不可变行，不像 `agent_actions` 的 feedback 可变，**不需要** md5 指纹版本），`processMemoryDistill` 消费后写入，scheduler 用 `NOT EXISTS` 排除。
- `processMemoryDistill` 的输入合并两类事实：现有 `agent_actions` 反馈 + 编辑事件；`buildDistillPrompt` 增加编辑事实的渲染（形如 `- [edit/task] 标题 "X" → "Y"`），prompt 指令补充"用户对任务/线程的直接修改是纠偏信号"。
- 编辑事件**不直接 embed 进索引**——记忆入库走蒸馏产物 → 现有索引链路，本批不动。

## 工作流程：严格 TDD

每个验收点先写失败测试，再实现，再跑绿。顺序：

1. **探索 + 计划**：读完锚点文件和项目记忆后，产出一份简短计划（A 的端点形状决策、B 的表结构、测试文件清单），然后再动手。
2. **任务 A 红→绿**：测试先行，写完跑 `apps/server` 测试确认红，实现后绿。
3. **任务 B 红→绿**：同上。
4. 全量回归：server + web 全部测试通过。

### 任务 A 测试清单（`apps/server/__tests__/agent/`，参考现有 `actions.test.ts` 的 mock 方式）

- [ ] accepted + task.decompose → 子任务在同一事务创建（条数、parentId、outcomeId 继承、estimateMinutes），`feedbackPayload.materialized.taskIds` 记录全部 ID
- [ ] 重复 accept → 409，不产生第二份子任务
- [ ] 物化中途失败（如某子任务数据非法/伪造 db 错误）→ 整体回滚，action 仍是 pending，无子任务残留
- [ ] dismiss / edited / task.draft 路径行为不变（回归）
- [ ] undo：accepted + materialized → 子任务全部软删、feedback='undone'；任一子任务已完成或已删 → 409；非 accepted 状态 → 409/404
- [ ] 物化创建的子任务 sortOrder 由 `nextSortOrder` 逻辑分配（追加在 parent 现有子任务之后），多子任务相对顺序与 payload 一致
- [ ] undo 后 metrics：该行不再计入 adopted、计入 undone 桶；web 活动记录显示"已撤销"
- [ ] web：DecomposeBanner accept 只发一个请求（更新现有 task-detail 测试）

### 任务 B 测试清单

- [ ] 用户改任务标题/截止/挪线程 → 事件落库，before/after 正确，多字段一次编辑合并为一行
- [ ] agent 写库路径（headline 更新、draft 追加 notes、edited 分支改名、**decompose 物化创建子任务**）→ 不产生事件
- [ ] 无实质字段变化的 update → 不落
- [ ] scheduler：存在未消费 edit events → memory.distill 被 mark；消费后（指纹写入）不再触发
- [ ] buildDistillPrompt 输入包含编辑事实，渲染符合预期
- [ ] 回归：现有 `memory-distill-dedup.test.ts`、`memory-hybrid.test.ts` 等全部通过

## csi 验收（实现完成后做）

按记忆 `vital-csi-verification.md` 的流程（dev 登录、页面内 API 造数 refresh→Bearer、截图 originalUrl 去重）：

1. **环境**：dev 库**手动**跑 0028 迁移（dev/test 库分离，drizzle-kit 默认只迁 test）；**重启 dev server 和 worker**（csi 前确认跑的是新代码）；api-client 重新 build。
2. **场景 A**：造一个高 deferCount 的任务 + 一条 pending 的 `task.decompose` action（页面内 API 造数）→ 打开 TaskDetail 看到拆解 banner → 点采纳 → 子任务一次全部到位、banner 消失 → 重复发 accept 请求得 409 → 调 undo → 子任务消失、执行记录显示 undone。全程截图对比。
3. **场景 B**：改一个任务标题 → 查库 `agent_edit_events` 落库且 before/after 正确 → 手动触发 `POST /api/v1/agent/memory/distill` → 从执行记录/日志确认蒸馏 prompt 包含该编辑事实。
4. 截图归档到约定目录，originalUrl 去重后交付。

## 完成定义（DoD）

- [ ] 上述两个测试清单全绿，server + web 全量回归通过
- [ ] csi 两个场景截图验收通过
- [ ] 更新 `skills/vital/references/api.md`（新增/变更的 API 文档）
- [ ] **不 commit、不 push**，输出完成报告：实现摘要、测试结果、csi 截图路径、遗留问题

## 禁止事项

- 不做其他批次内容（评估体系、主动程度开关、重复检测、淘汰策略、调度优化等），哪怕看起来顺手
- 不改 `MEMORY_TOTAL_LIMIT` / 蒸馏淘汰逻辑
- 不动工作区已有的未提交改动
- 不引入新依赖
