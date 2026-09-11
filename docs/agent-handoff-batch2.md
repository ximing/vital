# Handoff：有效建议成本 + 固定案例评估 + 调度可见性（第二批）

你是接手 vital 项目本轮开发的实现 Agent。本文档是唯一需求来源，按顺序执行。
项目根目录：`/Users/ximing/project/mygithub/vital`（pnpm monorepo，server 为 Fastify + Drizzle，web 为 React）。

## 背景

vital 的自进化闭环 = 信号采集 → 蒸馏 → 检索注入 → 提案 → 再反馈。第一批（已实现、**未提交**、正在验收）补了信号采集：decompose 服务端物化 + undo（`'undone'` 终态）+ 用户编辑事件流（`agent_edit_events`）。

本批闭环"**可衡量**"和"**可观测**"两环：

- **任务 A**：有效建议成本——现在 `agent_usage` 记了钱、`agent_actions` 记了采纳，但两边没打通，无法回答"每条被采纳的建议花了多少"。并搭一个固定案例评估脚本（离线、可重复、不碰生产路径），作为后续改 prompt / 调度的决策依据。
- **任务 B**：调度可见性——`agent_scheduling` 表里 dueAt / cooldownUntil / pendingCount 都在写，但用户看不到"Agent 在等什么、什么时候跑、为什么还没跑"。补一个只读视图 + 取消。

## 开始前必读

1. 项目记忆（坑都在里面）：
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-batch1-transactional-acceptance.md`（**上一批的产出与 drizzle journal 时间戳单调递增的坑**）
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-csi-verification.md`（csi 验收实操）
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-v13-status.md`（csi 前确认 worker 是新代码）
2. 仓库有 CodeGraph 索引（`.codegraph/`），定位代码优先用 `codegraph explore` 或 MCP 工具。
3. 工作区有**上一批未提交的改动**（批次 1：物化/undo/编辑事件流）。你是在它之上开发——不要 revert、不要 stash、不要 commit/push 任何东西。

## 现状锚点（已核实，从这里开始读代码）

| 锚点 | 现状 |
|---|---|
| `apps/server/src/agent/metrics.service.ts:41-102` | **已存在**：日级 proposed/adopted/dismissed/**undone** 计数、adoptionRate、前一窗口 prevAdoptionRate 趋势。任务 A 不要重做这些，在其上扩展 |
| `packages/dto/src/agent.ts:127-156` | `AgentAdoptionDaily` / `AgentMetricsSummary` / `AgentMetricsResponse`，undone 字段已有 |
| `apps/server/src/agent/usage.service.ts:7-65` | `dailyUsage`：agent_usage 按 日×capability 聚合 runs/tokens/costMicros，含 failed/unknown 分桶 |
| `apps/server/src/agent/agent.routes.ts:29-35` | **"立即执行"已存在**：`POST /api/v1/agent/cluster`、`POST /api/v1/agent/memory/distill` 走 `dispatchAgentSchedule(userId, capability, now, manual=true)`。任务 B 不新增触发端点，复用这两个 |
| `apps/server/src/agent/scheduling.ts:39-48` | `finishAgentSchedule`：generation 消费语义（processedGeneration、pendingCount 清零）——**取消的语义照这个模式** |
| `apps/server/src/db/schema/agent-scheduling.ts` | 表结构全字段：generation / processedGeneration / pendingCount / urgent / pendingSince / dueAt / cooldownUntil / lastSucceededAt / observedAt。**本批大概率不需要迁移**；若确需改表，迁移编号 0029，且先读上面记忆里 journal 时间戳的坑 |
| `apps/web/src/features/settings/` + `apps/web/__tests__/features/settings/agent-activity.test.tsx` | Agent 活动视图（设置页），批次 1 刚加了 undone 标签。调度可见性 UI 放同一区域 |
| `apps/server/src/agent/processors.ts` | 各 processor 的 `usageCapability` 值是任务 A 建映射的依据，先枚举所有调用点 |

## 任务 A：有效建议成本 + 固定案例评估

### A1 capability ↔ actionType 映射

打通成本和采纳的前提是知道"哪次 run 产生了哪类提案"。**不要凭记忆写映射**——先枚举 `processors.ts` 里所有 `runWithCritic` / `recordUsage` 调用点的 `usageCapability` 实际值和对应的 `recordAgentAction` actionType，得出映射表（预期形状：`'headline' → ['outcome.headline', 'outcome.suggestion']`、cluster/decompose/draft 各对应一个，以实际代码为准）。

- 把映射写成显式常量（如 `apps/server/src/agent/eval/capability-map.ts`），**用测试锁死**：断言每个映射的 usage capability 在 `agentUsage.capability` 的实际写入值里存在、每个映射的 actionType 在 `agentActionTypeSchema` 里存在。代码将来加能力时这个测试会失败提醒更新映射——这正是要的效果。
- 注意：一次 run 可能产出多条 action（headline run 产出 headline + suggestion 两条），成本按 capability 汇总后除以该 capability 采纳数，语义是"每条已采纳建议的摊销成本"，在 DTO 注释里写清楚。

### A2 指标扩展

在 `metrics.service.ts` 的 summary 中增加按 capability 的有效建议成本：

- `AgentMetricsSummary` 扩展 `perCapability: Array<{ capability, costMicros, adopted, costPerAdoptedMicros | null }>`（null = 该 capability 窗口内采纳数为 0，除不开）。
- 成本取 `agent_usage` 同窗口（days 参数一致、同 timezone 分桶约定）按 capability 汇总的 costMicros；采纳数取 `agent_actions` 按 A1 映射归属到 capability 的 adopted（accepted + edited；undone 不算采纳）。
- **窗口对齐注意**：metrics 的 prev 窗口只用于 adoptionRate 趋势，成本指标只算当前窗口，不做趋势——写进 DTO 注释，避免后续误用。
- web 端：agent 活动设置页在采纳率卡片旁渲染每能力成本行（复用现有卡片样式，参考 `apps/web/src/features/settings/` 现有结构；文案进 `copy.ts`，mobile 的 copy 若同 key 联动则同步）。

### A3 固定案例评估脚本（离线，不碰生产路径）

新建 `apps/server/scripts/eval/`（或项目惯用的 scripts 位置，先看 `apps/server/package.json` 现有 script 惯例）：

- **种子固定案例**：一个确定性的 fixture 集（固定用户/固定一组 `agent_actions` 反馈 + `agent_usage` 记录 + 若干 `agent_memory`），以 SQL 或 TS fixture 形式入库到 **test 库**（复用 `__tests__/helpers/db.ts` 的建库机制）。
- **评估 runner**：`pnpm eval:agent` 之类的一条命令——灌种子 → 调 `agentAdoptionDaily` / 新的成本指标 → 输出快照 JSON 到固定路径（如 `scripts/eval/__snapshots__/latest.json`）。
- **快照对比**：runner 带 `--check` 模式，与已提交的基准快照 diff，不一致 exit 1。这就是"改 prompt / 调调度后跑一下看指标动没动"的最小闭环。
- 范围收敛：本批只覆盖**反馈类指标**（proposed/adopted/dismissed/undone/adoptionRate/costPerAdopted）。记忆召回率、rerank 增益是第三批，**不要做**。

## 任务 B：调度可见性

### B1 只读视图

新增 `GET /api/v1/agent/schedule`：

- 返回当前用户所有 `agent_scheduling` 行（capability 枚举当前只有 `outcome.cluster` / `memory.distill`），字段透传 + 一个**服务端派生的 `status`**：
  - `idle`：无待处理（pendingCount = 0 或 generation <= processedGeneration）
  - `waiting`：有待处理、dueAt 在未来
  - `due`：dueAt <= now（正在等 worker 扫描）
  - `cooldown`：cooldownUntil > now 且有待处理
  - 判定顺序从上到下，写测试锁死优先级（比如 cooldown 与 due 同时满足时算哪个）。
- 派生用 `req.user` 的时区无关（全是时间戳比较），ISO 字符串返回。DTO 进 `packages/dto/src/agent.ts`，api-client 加方法（**改完重新 build api-client**——项目记忆的坑）。

### B2 取消

新增 `POST /api/v1/agent/schedule/:capability/cancel`：

- 语义照 `finishAgentSchedule` 的消费模式但不执行：事务 + `lockAgentUser`，`processedGeneration = generation`、`pendingCount = 0`、`pendingSince = null`、`urgent = false`、`dueAt = null`。
- **明确语义**：取消的是"已积累的待处理观察"，之后的用户活动会正常重新 mark（generation + 1）——不是关闭该能力。在 DTO/文档注释里写清楚。
- capability 不在枚举内 → 404；无待处理状态时取消 → 幂等成功（返回取消后状态即可，不报错）。
- **不做**"主动程度开关"（auto/suggest/pause per capability）——那是第三批随首个 auto 能力一起做的事，本批只有可见性和取消。

### B3 前端

设置页 Agent 区域新增"调度"小节：每个 capability 一行（状态徽章 + pendingCount + dueAt/cooldownUntil 的本地化时间 + 上次成功时间），行内两个操作：

- **立即执行**：调已有的 `POST /api/v1/agent/cluster` / `/agent/memory/distill`（api-client 已有或补方法）。
- **取消**：调 B2 端点，成功后刷新视图。
- "预算不足已暂停"这类原因展示本批**不做**（需要 budget 状态联动，后续批次）。

## 工作流程：严格 TDD

每个验收点先写失败测试，再实现，再跑绿。顺序：探索 + 计划（A1 映射表、B 端点形状、fixture 设计先写下来）→ 任务 A 红→绿 → 任务 B 红→绿 → server + web 全量回归。

### 任务 A 测试清单（`apps/server/__tests__/agent/`）

- [ ] capability↔actionType 映射测试：每个 usage capability 匹配 agentUsage 实际写入值、每个 actionType 在 schema 枚举内（防未来漂移）
- [ ] perCapability 成本：有采纳时 costPerAdopted = costMicros/adopted；采纳为 0 → null；undone 不计入 adopted
- [ ] headline run 产出两条 action 的摊销语义正确（一次 run 的成本摊到两条已采纳建议）
- [ ] 窗口一致性：days/timezone 与现有 windowDaily 行为一致
- [ ] 评估 runner：同一 fixture 跑两次快照一致；篡改一条反馈（accepted→dismissed）后 `--check` 失败 exit 1
- [ ] 回归：现有 `metrics.test.ts` 全绿

### 任务 B 测试清单

- [ ] GET schedule：各字段透传、四种 status 派生正确、优先级锁定
- [ ] cancel：有待处理 → 全部归零且后续 mark 会重新累积（generation 语义）；无待处理 → 幂等成功；非法 capability → 404
- [ ] cancel 与 finishAgentSchedule 的并发语义不互相破坏（照 `scheduling.test.ts` 现有测试方式）
- [ ] 回归：`scheduling.test.ts`、路由测试全绿
- [ ] web：设置页渲染调度行、立即执行/取消按钮调用正确端点（参考 agent-activity.test.tsx 的测试方式）

## csi 验收（实现完成后做）

按记忆 `vital-csi-verification.md` 流程（dev 登录、页面内 API 造数、originalUrl 去重）：

1. **环境**：本批预计无迁移；若最终加了 0028+ 的迁移，dev 库**手动**跑。重启 dev server 和 worker（csi 前确认新代码）；api-client 重新 build。
2. **场景 A（成本）**：造数——几条不同 feedback 的 `agent_actions` + 对应 `agent_usage` 记录 → 打开设置页 Agent 区域 → 采纳率卡片和每能力成本行数值正确（手算核对一组）→ `pnpm eval:agent` 产出快照 → 改动一条反馈再跑 `--check` 确认能抓到 diff。
3. **场景 B（调度）**：通过正常使用（改几个任务标题触发编辑事件）让 memory.distill 进入 pending → 设置页看到 `waiting` 行和 pendingCount → 点立即执行 → 执行记录出现新 run、行回到 idle → 再触发一次 pending 后点取消 → 行立即回 idle、随后再次编辑任务又重新进入 pending。
4. 截图归档，originalUrl 去重后交付。

## 完成定义（DoD）

- [ ] 两个测试清单全绿，server + web 全量回归通过
- [ ] csi 两个场景截图验收通过
- [ ] 更新 `skills/vital/references/api.md`（新增/变更 API）
- [ ] **不 commit、不 push**，输出完成报告：实现摘要、A1 映射表及依据、测试结果、csi 截图路径、遗留问题

## 禁止事项

- 不做第三/四批内容：主动程度开关、收集时重复检测、lastRetrievedAt 淘汰、自动合并、两阶段聚类、调度器扫描优化、记忆召回率/rerank 增益指标、预算暂停原因展示——哪怕看起来顺手
- 不改批次 1 的物化/undo/编辑事件流逻辑（验收发现问题→写进报告，不要自行改）
- 不动 `MEMORY_TOTAL_LIMIT` / 蒸馏淘汰逻辑
- 不引入新依赖（评估 runner 用现有测试基建）
- 不 commit、不 push
