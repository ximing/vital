# Handoff：收集时重复检测 + 检索价值淘汰（第三批）

你是接手 vital 项目本轮开发的实现 Agent。本文档是唯一需求来源，按顺序执行。
项目根目录：`/Users/ximing/project/mygithub/vital`（pnpm monorepo，server 为 Fastify + Drizzle，web 为 React）。

## 背景

vital 的自进化闭环 = 信号采集 → 蒸馏 → 检索注入 → 提案 → 再反馈。前两批已落地：信号采集（物化/undo/编辑事件流）与可衡量/可观测（成本评估 + 调度可见性），均已 commit。

本批把检索设施"顺水推舟"用到两个新位置：

- **任务 A（#6）**：收集时重复检测——inbox 转任务、快速建任务、智能解析建任务时，查一下未完成的相似任务，非阻塞提示"可能已有：XXX"。减少后续聚类和拆解的噪音输入。
- **任务 B（#8）**：记忆淘汰从"条数上限 + 最旧优先"改为"检索价值优先"——蒸馏当前超过 30 条就淘汰最旧的 non-manual 行，与记忆是否有用无关。改为淘汰"长期未被任何检索命中"的记忆。

两条设计决策**已核实代码后定死**，不要更改（有疑问写在报告里）：
1. 任务 A 用"索引命中 + SQL 近期窗口补召回"解决索引滞后，**不**把索引写入搬进 agent_jobs（那是后续量级问题）。
2. 任务 B 淘汰规则带**宽限期**，防止新记忆被误杀（详见 B2）。

## 开始前必读

1. 项目记忆：
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-batch2-cost-eval-schedule.md`（上一批产出 + **pnpm script 参数透传、gen-vital-skill 再生成**的坑）
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-batch1-transactional-acceptance.md`（drizzle journal when 时间戳单调递增的坑——本批要出 0030 迁移）
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-csi-verification.md`、`vital-v13-status.md`（csi 流程与 worker 重启）
2. 仓库有 CodeGraph 索引（`.codegraph/`），定位代码优先用 `codegraph explore` 或 MCP 工具。
3. 工作区状态：前两批（物化/undo/编辑事件流、成本评估/调度可见性）已 commit。当前未提交改动属于**另一批进行中的工作**（mobile 端 UI 重构 + `report.generate` 能力，含 0029 迁移）——等它 commit 后再启动本批；若启动时它仍未提交，**不要动这些文件**，尤其 `processors.ts`、`agent.ts` schema、`_journal.json` 与 0029 迁移（本批的 0030 迁移排在它之后）。

## 现状锚点（已核实，从这里开始读代码）

| 锚点 | 现状 |
|---|---|
| `apps/server/src/retrieval/tasks.ts:140-217` | `searchSimilarTasks`：混合检索（Qdrant 向量 ∪ Meili 稀疏 → RRF → rerank），支持 `status` / `excludeId` 过滤，返回 `SimilarTaskHit {id, title}`；**客户端未配置时返回 null，infra 错误向上抛（调用方须 catch 降级）**。目前仅 processors 1 个调用点（`processors.ts:254`） |
| `apps/server/src/retrieval/pipeline.ts:146-211` | `searchMemories`：混合记忆检索，同样 null 降级语义；**hit 之后什么都不记**（任务 B 要加 lastRetrievedAt） |
| `apps/server/src/agent/harness.ts:37` | `loadAgentMemory`：**混合路径与 PG fallback 都收敛在这个函数**（有 query 走 `searchMemories`，null/异常时落到 PG recency 路径）。任务 B 的 lastRetrievedAt 更新点就在这里，覆盖两个分支 |
| `apps/server/src/agent/harness.ts:75` 附近 | PG fallback 路径的 select **只取 `kind`/`content`，不含 `id`**——要更新 lastRetrievedAt 必须先给这个 select 加 id，这是最容易漏的一步 |
| `apps/server/src/agent/processors.ts:75` | `MEMORY_TOTAL_LIMIT = 30`；evict 循环在 `processors.ts:823` 附近（`orderBy asc createdAt` 后逐条删 non-manual 直到回到上限）——任务 B 改这里 |
| `apps/server/src/retrieval/pipeline.ts:23` | `trackIndexJob`：fire-and-forget 索引 + 每日 index.sync 兜底——**刚建的任务可能不在索引里**，这就是任务 A 要 SQL 补召回的原因 |
| `apps/server/src/llm/parse-task.ts:267` | `interpretTaskText`：智能解析建任务的 LLM 入口 |
| `apps/server/src/inbox/inbox.service.ts` | inbox convert → 建任务 |
| `apps/server/src/tasks/tasks.service.ts:440` | `createTask`（sortOrder 在这层分配）；**注意：decompose 物化（批次 1）也走建任务**——重复检测不能对这些内部创建触发，接线位置见 A1 |
| `apps/server/drizzle/` | 最新 0029（`report.generate` 枚举扩展，**未提交**），本批新迁移从 **0030** 开始，journal when 时间戳必须大于 0029 的 |
| rerank 服务 | `rerank.rerankTexts` 的返回形状（是否带 score）**先核实**，任务 A 的阈值过滤依赖它 |

## 任务 A：收集时重复检测

### A1 共享查重函数 + 接线位置

新建共享函数（建议放 `apps/server/src/retrieval/tasks.ts` 旁或独立 service）：

```
findPotentialDuplicates(userId, query, excludeId?): Promise<SimilarTaskHit[]>
```

- 候选来源 = `searchSimilarTasks(status 为未完成)` + **SQL 近期窗口**（近 14 天内 updatedAt 的 open 任务，`todo`/`doing`，limit 50）——SQL 窗口兜住"刚建还没进索引"的任务；两路候选按 id 去重后**合并过 rerank**（rerank 本来就在管线里）。
- 返回 top 3。若 rerank 带 score，低于阈值的不返回（阈值先给经验值并在常量处注释可调）；若 rerank 不带 score，则只返回 top 3 不做阈值，写注释说明。
- **全部 best-effort**：检索客户端缺失 → 空数组；任何 infra 错误 → catch 后空数组 + `[retrieval]` 日志。**绝不阻塞、绝不失败建任务本身**。
- query 长度 < 4 字符直接返回空（短标题无查重意义）。

**接线位置在 HTTP 路由层，不在 `createTask` service 里**——理由：decompose 物化、习惯生成等内部建任务不该触发查重。三个接线点：

1. `POST /api/v1/tasks`（快速建任务）
2. inbox convert 路由（`ConvertInboxResponse` 扩展字段）
3. 智能解析建任务路由（`interpretTaskText` 的调用处）

响应统一加可选字段 `similarOpenTasks?: SimilarTaskHit[]`（top 3），DTO + api-client 同步（**api-client 改完重新 build**）。

### A2 前端（本批只做 web，mobile 记为遗留）

- 建任务/转任务成功后，若响应带 `similarOpenTasks`，以非阻塞提示展示"可能已有：XXX"（可点击跳任务详情、可关闭），样式对齐现有 banner/toast 惯例。
- 文案进 `copy.ts`（注意 mobile copy 同 key 联动则同步，不同则不动 mobile）。
- 提示不得出现在 decompose 物化等 agent 路径（服务端路由层接线已保证，前端无需判断）。

## 任务 B：检索价值淘汰

### B1 lastRetrievedAt

- 迁移 0030：`agent_memory` 加 `last_retrieved_at timestamptz null`（注意 journal when 单调递增的坑，且排在未提交的 0029 之后）。
- **更新点收敛在 `harness.ts` 的 `loadAgentMemory`**（`searchMemories` 的全部调用方都在这里）：混合路径 hits 非 null 时更新 hit id 集合；PG fallback 路径先给 select 补上 `id` 再同样更新。批量 `UPDATE agent_memory SET last_retrieved_at = now WHERE id IN (...)`。放在 hits 确定之后（rerank 之后的结果，不是 recall 阶段的候选）。
- 写放大在本规模下可接受（每次命中几十行 update），注释说明。
- **索引无需重建**：lastRetrievedAt 不进 Qdrant/Meili 的内容字段，touch 记忆不得触发 re-index。

### B2 淘汰规则（防误杀）

`processMemoryDistill` 的 evict 逻辑改为：

- `MEMORY_TOTAL_LIMIT = 30` 保留为硬上限；
- 超限时，在 **non-manual 且 `createdAt < now - 7 天`（宽限期 GRACE，提为常量）** 的行中，按 `COALESCE(last_retrieved_at, created_at)` **最旧优先**淘汰，直到回到上限内；
- manual 永不淘汰（现状保持）；宽限期内的新记忆**永不淘汰**（即使总数超限也先不淘汰它们——上限短暂突破可接受，写注释说明取舍）；
- 淘汰发生在与现在相同的事务/位置，`agent_memory_history` 照现有方式留痕，`executionResult` 里记录淘汰了哪些及原因（可观测性）。

## 工作流程：严格 TDD

探索 + 计划（A1 函数签名与三处接线、B2 淘汰伪代码、rerank 返回形状核实结果，先写下来）→ 任务 A 红→绿 → 任务 B 红→绿 → server + web 全量回归。

### 任务 A 测试清单

- [ ] findPotentialDuplicates：索引命中 + SQL 近期窗口候选合并去重；刚建未进索引的任务通过 SQL 窗口被召回（**这条是本批的核心价值，必须显式测试**）
- [ ] 检索客户端缺失 → 空数组；infra 错误 → 空数组且不抛；query < 4 字符 → 空
- [ ] 三个路由（tasks create / inbox convert / 智能解析）响应带 `similarOpenTasks`；**decompose 物化路径（批次 1 的 accept）不产生查重**
- [ ] 建任务本身在任何检索失败下都成功（响应只是不带字段）
- [ ] 回归：`apps/server/__tests__/retrieval/` 现有测试全绿

### 任务 B 测试清单

- [ ] 混合路径与 PG fallback 路径命中后 lastRetrievedAt 都被更新（两条路径分别测；PG fallback 的 select 补 id 后行为不变——kind/content 返回值与排序不回归）
- [ ] 超限淘汰：宽限期内新记忆不被淘汰（总数可短暂超 30）；宽限期外按 COALESCE 最旧先走；从未被召回的老记忆先于最近被召回的老记忆被淘汰；manual 永不淘汰
- [ ] 淘汰留痕：agent_memory_history 有记录、executionResult 含淘汰摘要
- [ ] touch 记忆不触发 re-index（若有索引调用 mock，断言未发生）
- [ ] 回归：`memory-distill-dedup.test.ts`、`memory-hybrid.test.ts`、`pipeline.test.ts` 等全绿

## csi 验收（实现完成后做）

按记忆 `vital-csi-verification.md` 流程（dev 登录、页面内 API 造数、originalUrl 去重）：

1. **环境**：dev 库**手动**跑 0030 迁移（dev/test 库分离；若 0029 尚未在 dev 上跑过，先跑 0029）；重启 dev server 和 worker；api-client 重新 build。确认 dev 环境检索客户端（Qdrant/Meili/embedding）已配置——没配置的话 SQL 窗口路径仍应工作（这本身是个验收点）。
2. **场景 A（重复检测）**：建任务"提交季度报告" → 再建"提交季度报告 "（近似标题）→ 提示"可能已有"出现且可跳转；**紧接着连续建两个相似任务**（第二个命中第一个，此时第一个尚未进索引——验证 SQL 窗口路径）；触发一次 decompose 采纳 → 子任务创建无任何查重提示闪现。
3. **场景 B（淘汰）**：页面内 API 造数灌 30+ 条记忆（含 manual、含不同 createdAt）→ 触发 `POST /api/v1/agent/memory/distill` → 查库验证：淘汰名单符合 B2 规则、lastRetrievedAt 在检索后更新、执行记录里有淘汰摘要。
4. 截图归档，originalUrl 去重后交付。

## 完成定义（DoD）

- [ ] 两个测试清单全绿，server + web 全量回归通过
- [ ] csi 两个场景截图验收通过
- [ ] 更新 `skills/vital/references/api.md`（响应字段变更）+ 执行 gen-vital-skill 再生成（上一批的坑）
- [ ] **不 commit、不 push**，输出完成报告：实现摘要、rerank 返回形状核实结果、阈值/宽限期常量的取值与理由、测试结果、csi 截图路径、遗留问题（mobile 端查重提示、#10 索引写入持久化）

## 禁止事项

- 不做后续批次内容：自动合并（#5）、两阶段聚类（#7）、主动程度开关、调度器扫描优化（#9）、索引写入搬进 agent_jobs（#10）、召回率/rerank 增益评估指标——哪怕看起来顺手
- 不改前两批的物化/undo/编辑事件流/成本评估逻辑
- 不动 `MEMORY_TOTAL_LIMIT = 30` 的数值本身
- 不动进行中批次的未提交改动：mobile 重构、`report.generate` 相关代码与测试（`processors.ts` 里 report 的部分只读不写）
- 不引入新依赖
- 不 commit、不 push
