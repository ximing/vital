# Handoff：检索维度评估指标（批次 3.5）

你是接手 vital 项目本轮开发的实现 Agent。本文档是唯一需求来源，按顺序执行。
项目根目录：`/Users/ximing/project/mygithub/vital`（pnpm monorepo，server 为 Fastify + Drizzle，web 为 React）。

## 背景

vital 的固定案例评估体系（批次 2）目前只覆盖**反馈/成本维度**（proposed/adopted/undone/adoptionRate/costPerAdopted，`pnpm eval:agent`）。本批补上**检索维度**：记忆召回率、rerank 增益、查重质量。这是下一批（自动合并、两阶段聚类——都会改变检索和提案行为）的前置评估基座：没有这些指标，改了检索管线无法知道变好还是变坏。

本批**不改变任何生产行为**——只加评估代码（新脚本 + 新测试 + 少量可复用的提取函数）。这是"纯观测"批次。

## 开始前必读

1. 项目记忆：
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-batch2-cost-eval-schedule.md`（eval 骨架的设计与 **pnpm script 参数透传、gen-vital-skill 再生成**的坑）
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-batch3-dedup-eviction.md`（批次 3 产出：duplicates.ts / lastRetrievedAt / 宽限期淘汰，**未 commit**——本批在它之上开发，不要动它）
   - `/Users/ximing/.claude/projects/-Users-ximing-project-mygithub-vital/memory/vital-batch1-transactional-acceptance.md`（drizzle journal 时间戳坑——本批预计无迁移）
   - `vital-csi-verification.md`（csi 流程）
2. 仓库有 CodeGraph 索引（`.codegraph/`），定位代码优先用 `codegraph explore` 或 MCP 工具。
3. 工作区有批次 3 的未提交改动（duplicates / 淘汰 / 0033 迁移）。**不要 revert、不要 commit**；本批改动与它并行，报告里分清哪些文件是批次 3 的、哪些是本批的。

## 现状锚点（已核实，从这里开始读代码）

| 锚点 | 现状 |
|---|---|
| `apps/server/scripts/eval/core.ts` / `fixture.ts` / `run.ts` | **批次 2 的 eval 骨架，直接扩展**：固定 fixture 用户（`FIXTURE_USER_ID`）、确定性种子、`buildSnapshot` → JSON 快照、`--check` diff / `--update` 重建基线 / `--tamper` 演示漂移。`pnpm eval:agent`（`apps/server/package.json:16`，NODE_ENV=test 只写测试库） |
| `apps/server/src/retrieval/pipeline.ts:146` | `searchMemories`：混合检索（Qdrant ∪ Meili → RRF(`rrf.ts:6`, k=60) → rerank → top limit）。**指标提取的观测点** |
| `apps/server/src/retrieval/tasks.ts:140` | `searchSimilarTasks`：任务混合检索，同构管线 |
| `apps/server/src/retrieval/duplicates.ts`（批次 3 新增） | `findPotentialDuplicates`：索引命中 + SQL 近期窗口 → 合并 rerank → top 3。**查重质量指标的对象** |
| `apps/server/src/retrieval/rerank.ts:55` | `rerankTexts` 返回 `{index, relevance_score}[]`（**已实测验证带 score**，注释注明 2026-09 live call）。rerank 增益和查重阈值都依赖它 |
| `apps/server/src/retrieval/registry.ts:102` | `setRetrievalClientsForTest` / `resetRetrievalClientsForTest`：**现成的 mock 缝**，评估脚本注入假客户端走这里（先读 `pipeline.test.ts` 的用法照抄） |
| `apps/server/src/agent/harness.ts:19` | `MEMORY_INJECT_LIMIT = 20`（注入上限）；`loadAgentMemory` 是检索的最终消费方 |
| `apps/server/src/agent/eval/capability-map.ts` | capability↔actionType 映射（防漂移测试锁死的模式——本批 metric 定义也照这个模式锁） |

## 任务 A：指标提取层（纯函数，生产代码内可复用的部分）

在 `apps/server/src/retrieval/` 新建 `eval-metrics.ts`（**纯函数，无 IO**）：

### A1 Recall@K（记忆召回率）

```
recallAtK(retrieved: string[], relevant: string[], k: number): number
```
- `relevant ∩ top-K(retrieved)` / `|relevant|`；relevant 为空时返回 0（约定，写注释）。

### A2 Rerank 增益

```
rerankGain(before: string[], after: string[], relevant: string[], k: number): { recallBefore, recallAfter, delta }
```
- `before` = RRF 融合排序（rerank 前），`after` = rerank 后排序；增益 = Recall@K(after) − Recall@K(before)。这是"rerank 有没有用、值不值这个成本"的直接答案。

### A3 查重精度/召回（duplicates 质量的基础口径）

```
duplicatePrecision(hits: string[], knownDupes: string[]): number
```
- 命中里真重复的占比。recall 版本同理（`duplicateRecall`）。固定案例里"已知重复对"由 fixture 定义。

每个函数 JSDoc 写清口径与边界约定。**用测试锁死**（纯函数测试，不需要 DB）。

## 任务 B：评估 runner 扩展

### B1 检索 fixture（确定性）

现有 `fixture.ts` 只有反馈/成本语料。**新增检索语料**（同文件或新文件，seed 时一并灌入）：

- **记忆召回案例**：固定一组 `agent_memory`（约 15 条，内容自拟、覆盖不同 kind/scope），并为 5 个固定查询各自定义 `relevant` id 集（人工标注——这就是"该注入的是否进 top-N"的 ground truth）。同时灌 Qdrant/Meili 假客户端（内存实现：向量 = 内容的确定性哈希或简单词袋，保证同内容同向量）。
- **查重案例**：固定 8 个任务（2 组已知重复对 + 4 个无关），定义 `knownDupes`。
- 假客户端走 `setRetrievalClientsForTest` 注入；评估结束 `resetRetrievalClientsForTest`。**先核实这套 test 缝在非 vitest 环境（tsx 脚本）里是否可用**——它是模块级单例的话直接可用；若依赖 vitest 的 mock 机制，改用同一接口的内存实现并说明。

### B2 指标计算与快照

`buildSnapshot` 扩展（或新增 `buildRetrievalSnapshot`，与反馈快照并列写入同一个 JSON——**version 升到 2**，`diffSnapshots` 同步扩展）：

- **记忆召回**：对每个固定查询跑 `searchMemories`（会真的经过 RRF + rerank——假 rerank 客户端按 relevance_score 模拟，如"词袋重合度"确定性打分），算 `Recall@K`（K = `MEMORY_INJECT_LIMIT` 与 10 两组）。
- **rerank 增益**：对同一组查询，分别取 RRF 融合排序和 rerank 后排序（需要从 `searchMemories` 内部把 rerank 前的顺序暴露出来——**加一个可选的观测回调参数或返回 debug 字段**，生产调用方不传即零开销；改 `searchMemories` 签名时保证现有 3 个调用方不破坏）。
- **查重质量**：对固定案例跑 `findPotentialDuplicates`，算 precision / recall。
- 快照新增字段：`retrieval: { memoryRecall: {query, recall@20, recall@10}[], rerankGain: {query, delta}[], duplicates: {precision, recall} }`。

### B3 脚本与文档

- `run.ts` 与 `pnpm eval:agent` 合一（快照变厚，无需新命令）；`--check` / `--update` / `--tamper` 语义不变。
- `--tamper` 演示扩展一个检索向漂移：如把某查询的 relevant 集换掉一条，`--check` 必须失败。
- `scripts/eval/README.md`（或注释）：每个指标的含义、口径、什么改动预期会动哪个指标（例：改 RRF k 值 → rerankGain 变；改查重阈值 → duplicates.precision/recall 变）。

## 工作流程：严格 TDD

探索 + 计划（A 的函数签名、B1 假客户端方案、`searchMemories` 观测参数的形状，先写下来）→ 任务 A 红→绿 → 任务 B 红→绿 → server + web 全量回归。

### 测试清单

- [ ] `eval-metrics.ts` 纯函数：recallAtK 边界（空 relevant / 全命中 / 部分命中 / K 截断）；rerankGain 三态（变好/变差/不变）；duplicatePrecision/Recall
- [ ] 假检索客户端：确定性（同输入两次运行同输出）；未注入时 `searchMemories` 走原有 null 降级
- [ ] `searchMemories` 观测参数：不传时行为与现在完全一致（现有 `pipeline.test.ts` 回归即证）；传时能拿到 rerank 前后两个序列
- [ ] 快照：同一 fixture 两次运行 diff 为空；篡改 relevant 集 → `--check` exit 1；篡改反馈（批次 2 的 tamper）依然被抓
- [ ] 版本迁移：旧 baseline（version 1）遇到新 runner → 明确报错提示 `--update`，不是静默 diff 失败
- [ ] 回归：批次 2 的 `eval-runner.test.ts`、批次 3 的 `duplicates.test.ts`、`pipeline.test.ts` 全绿

## csi 验收（本批为纯后端/脚本，验收简化）

1. **环境**：无迁移；NODE_ENV=test 跑 `pnpm eval:agent`（只写测试库，dev 数据不受影响——**这是验收点，跑完查 dev 库 agent_memory 无新增 fixture 用户数据**）。
2. `pnpm eval:agent`：产出含 retrieval 段的 latest.json，指标数值符合手工推演（对至少 1 个查询手工算 recall 核对）。
3. `pnpm eval:agent --check`：连续两次通过；`--tamper` 两种篡改（反馈类 + 检索类）都 exit 1。
4. 旧 baseline 触发明确升级提示。
5. 生产路径行为不变：dev 页面正常建任务、记忆注入（可在 dev 触发一次 distill 观察）不受假客户端影响（test 缝只在评估进程内注入）。
6. 截图/终端输出归档，originalUrl 去重后交付。

## 完成定义（DoD）

- [ ] 测试清单全绿，server + web 全量回归通过
- [ ] csi 验收通过
- [ ] `scripts/eval/README.md` 指标口径文档
- [ ] **不 commit、不 push**，输出完成报告：实现摘要、假客户端方案与确定性论证、指标初值及其解读（基线画像）、searchMemories 观测参数的最终形状、测试结果、遗留问题（真实数据画像需使用期积累）

## 禁止事项

- **不改任何生产行为**：`searchMemories` / `findPotentialDuplicates` / `loadAgentMemory` 的默认行为一字不变（只允许加可选观测参数）；不改注入上限、RRF k 值、查重阈值
- 不做下一批内容：自动合并（#5）、两阶段聚类（#7）、召回率驱动的调度——本批只建立"尺子"，不量了以后就动刀
- 不动批次 3 的未提交改动；不引入新依赖（假客户端内存实现手写）
- 不 commit、不 push
