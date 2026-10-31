# Personal Agent Continuity 实施拆分

日期：2026-10-30  
状态：T1–T11 均已由 SubAgent 落地；CONTINUITY_ENABLED 默认仍为 false  
输入：`prd-personal-agent-continuity.md`、`tech-personal-agent-continuity.md`

主 Agent 负责任务拆解、依赖排序、验收与派工。SubAgent 实现各自工作包。UI / 用户可见逻辑必须用 CSI（`POST http://127.0.0.1:10088/command`）做桌面与移动视口验证。后端不变量用 vitest，不用模型快照代替。

未形成 P1 闭环前，`CONTINUITY_ENABLED` 默认 false，调度与投递不得产生新效果。

## 0. 全景

Vital 已有线程（outcomes）、任务/习惯、agent_jobs、通知 outbox、plan preview/apply/undo、记忆、节假日表。本轮在现有单体增加 `apps/server/src/continuity/` 领域模块，线程详情提供「让 Vital 跟进」，不新开平行项目系统，不新开独立 Agent 服务。

```
任务/习惯/补记/约定变化
  → 同事务写 continuity_events + factsVersion++
  → worker 按事件或 nextCheckAt 重算
  → 规则计算机会、进展、候选（模型只写建议/材料）
  → 今天页 / 报告 / 通知共用候选与曝光账本
  → 用户补记 / 采纳 / 暂停 / 应用方案
  → 审计与下一次观察
```

规则负责日历、资格、权限、版本、预算、计数、状态迁移。模型失败不阻塞事实卡片。

P1（T1–T6）先打通长期投入闭环：算法/Agent 学习与锻炼。P2 工作风险，P3 假期探索。页面排序仍是工作风险优先；工程顺序是先打通托管账本。

## 1. 工作包 DAG

```
T1 schema/DTO/设置/归属/清理
 ├─ T2 证据/机会/停滞纯函数          （可在 T1 合并后立即开始）
 │   └─ T3 事件、到期扫描、handler、成本
 │       ├─ T4 候选、曝光、通知/报告
 │       └─ T5 约定/实验执行器、回顾、记忆抑制
 │           └─ T6 今天页、线程、聊天 + CSI     （依赖 T4+T5）
T7 依赖/保护安排/工作风险            （P2，依赖 T1–T6）
T8 跨事项方案原子组                  （P2，依赖 T7）
T9 假期窗口                          （P3）
T10 外部事实适配器与核实              （P3）
T11 分期回放与灰度                    （随期）
```

| ID | 包 | 依赖 | 验收 |
|---|---|---|---|
| T1 | schema、DTO、设置、归属、清理 | 无 | 旧线程默认未托管；重复激活唯一；跨用户 404；旗标关闭时不能新激活 |
| T2 | 证据、机会、停滞规则纯函数 | T1 | 周界、时区、宽限、暂停、补记、去重、撤销 |
| T3 | 事件、扫描、handler、成本 | T1/T2 | 提交后崩溃仍重算；过期租约不能落效果 |
| T4 | 候选、曝光账本、通知 | T3 | 并发预算不越界；旧候选失效；前台已见不补推 |
| T5 | 实验执行器、回顾、记忆抑制 | T2/T3 | 单事项原子组同事务；相同旧证据不重生 |
| T6 | 今天页、线程、聊天 | T4/T5 | CSI 跑完 P1 闭环，含失败与离线 |
| T7 | 依赖、保护安排、工作风险 | T1–T6 | 未知估时不伪造延期；依赖完成/撤销唤醒；共享空档不重用 |
| T8 | 跨事项方案原子组与撤回 | T7 | A 腾位失败则 B 不移入；undo 不覆盖后续用户修改 |
| T9 | 假期窗口、兴趣、拒绝去重 | T1–T6 | 调休/未知地区/关闭窗口/版本更新不重复推荐 |
| T10 | 外部事实适配器、采纳、核实 | T9/T4/T5 | 过期降级、核实失败明确、重复确认只建一次任务 |
| T11 | 三期回放 | T8+T10 | PRD §12.3 回放自动化 |

## 2. 验证约定

### 后端

- 规则纯函数注入 `now`。
- 集成测试覆盖归属、幂等、跨用户、级联清理、旗标关闭。
- `pnpm --filter @vital/dto build`、`pnpm --filter @vital/api-client build`、相关 vitest、改路由/DTO 后 `pnpm gen:vital-skill`。

### CSI（用户可见逻辑）

技能：`/Users/ximing/.grok/installed-plugins/csi-27a0f0bc/plugins/csi/skills/csi/SKILL.md`  
传输：`POST http://127.0.0.1:10088/command`，body `{"action","args","session"}`。连不上先 `~/.csi/bin/csi start`。

每个 UI 工作包必须：

1. `session` 固定为工作包名，例如 `continuity-t6`。
2. `navigate` 打开 `http://localhost:5180/...`（`newTab: true`）。
3. `snapshot` 取 `@e` refs，用 click/fill/wait，禁止 sleep 轮询。
4. 桌面（≥1280）与移动（375×812）各跑主路径。
5. 覆盖：无候选、停滞卡片、补记、暂停、失败/离线（能模拟则模拟）。
6. 把步骤与结果写进工作包验收记录。

T1–T5 无新 UI 时：若 `http://localhost:5180` 已在跑，CSI 打开 `/today` 做回归冒烟（页面可加载、现有线程仍在）。未在跑则在验收里写明未做 CSI，不以截图代替测试。

## 3. T1 详细规格（当前包）

范围：P1 表、DTO、用户设置、生命周期写入（草案/激活/暂停/恢复/结束）、归属、级联清理、旗标。  
不做：机会生成、停滞判定、候选投递、实验回顾、UI、agent_jobs 新类型。

### 3.1 旗标

`apps/server/src/config.ts` 增加 `CONTINUITY_ENABLED`，`boolEnum.default('false')`。

`apps/server/src/continuity/flag.ts`：

- `isContinuityEnabled()`
- `setContinuityEnabledForTest(value: boolean | null)` 仅测试使用

旗标关闭：GET 仍返回现有约定（便于暂停/清理）；`activate` / 更新草案返回 403 `CONTINUITY_DISABLED`。暂停、恢复、结束、清理始终可用。

### 3.2 Schema

新文件 `apps/server/src/db/schema/continuity.ts`，从 `schema.ts` 导出。禁止 `.references()`。一律 `id/user_id/created_at`（容器表加 `updated_at`）。ID 为 `char(36)`。

最新迁移是 `0060_task_milestone.sql`。用 `pnpm --filter @vital/server migrate:generate` 生成 `0061_continuity.sql`（若 drizzle-kit 自动起名，提交前改成可读名并同步 `drizzle/meta/_journal.json`）。

#### `continuity_user_settings`（1:1 用户）

| 列 | 类型 | 约束 |
|---|---|---|
| user_id | char(36) PK | |
| exploration_weekend | boolean | default false |
| exploration_holiday | boolean | default false |
| external_search | boolean | default false |
| daily_push_limit | integer | default 1，CHECK 1–5 |
| weekly_push_limit | integer | default 3，CHECK 1–14 |
| default_cadence | jsonb | 见 DTO，可空 |
| created_at / updated_at | timestamptz | |

#### `continuity_contracts`

| 列 | 类型 | 约束 |
|---|---|---|
| id | char(36) PK | |
| user_id | char(36) | |
| outcome_id | char(36) | unique (user_id, outcome_id) |
| lifecycle | varchar(16) | CHECK `draft \| active \| paused \| ended` |
| judgement | varchar(16) | 可空；CHECK `on_track \| watching \| needs_adjust \| waiting` 或 NULL |
| current_revision | integer | not null default 0 |
| authorization_version | integer | not null default 0 |
| facts_version | integer | not null default 0 |
| next_check_at | timestamptz | 可空 |
| paused_until | timestamptz | 可空 |
| in_app_only_until | timestamptz | 可空 |
| unanswered_streak | integer | not null default 0 |
| created_at / updated_at | timestamptz | |

索引：`idx_continuity_contracts_user_lifecycle_check (user_id, lifecycle, next_check_at)`。

#### `continuity_contract_revisions`

| 列 | 类型 | 约束 |
|---|---|---|
| id | char(36) PK | |
| user_id | char(36) | |
| contract_id | char(36) | |
| revision | integer | unique (contract_id, revision) |
| meaning | text | not null default '' |
| stage_goal | text | not null default '' |
| completion_criteria | jsonb | not null default `[]` |
| cadence | jsonb | not null |
| timezone | varchar(64) | not null |
| week_starts_on | smallint | not null，CHECK 0/1 |
| min_action | jsonb | not null |
| evidence_bindings | jsonb | not null default `[]` |
| actionable_windows | jsonb | not null default `[]` |
| authorization | jsonb | not null |
| concern_refs | jsonb | not null default `[]` |
| idempotency_key | varchar(128) | 可空 |
| activated_at | timestamptz | 可空（草案为 null） |
| created_at | timestamptz | |

部分唯一：`(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`。

#### `continuity_opportunities`

kind CHECK `timed | weekly_count`；status CHECK `scheduled | open | met | missed | exempt | canceled`。  
unique `(contract_id, revision, window_key)`。  
列：id, user_id, contract_id, revision, kind, window_key, starts_at, ends_at, check_at, local_start_date, local_end_date, timezone_snapshot, target_count, status, exempt_reason, created_at, updated_at。  
索引：`(user_id, check_at)`、`(contract_id, status)`。

T1 建表即可，不生成机会行。

#### `continuity_evidence`

source_type CHECK `task_done | habit_checkin | self_report | user_confirm | agent_prep`。  
actor CHECK `user | agent | system`。  
列：id, user_id, source_type, source_id, source_revision, actor, occurred_at, recorded_at, body, supersedes_id, retracted_at, idempotency_key, created_at。  
部分唯一：`(user_id, source_type, source_id, source_revision) WHERE source_id IS NOT NULL AND retracted_at IS NULL`。  
部分唯一：`(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`。  
索引：`(user_id, occurred_at)`。

#### `continuity_evidence_links`

列：id, user_id, evidence_id, contract_id, opportunity_id（可空）, meets_criteria boolean, rationale text, created_at。  
unique `(evidence_id, contract_id)`。

#### `continuity_interventions`

kind CHECK `stall_adjust | work_risk | explore | experiment_review`。  
status CHECK `open | snoozed | accepted | dismissed | resolved | expired | withdrawn`。  
列：id, user_id, contract_id, revision, kind, fact_fingerprint, status, expires_at, actionable_until, snoozed_until, content jsonb, draft_ref, created_at, updated_at。  
部分唯一：`(contract_id, kind, fact_fingerprint, revision) WHERE status IN ('open','snoozed')`。  
索引：`(user_id, status, expires_at)`。

#### `continuity_experiments`

status CHECK `draft | active | review_ready | completed | interrupted | superseded`。  
列：id, user_id, contract_id, before_revision, after_revision, hypothesis, baseline jsonb, goal jsonb, window_start, window_end, plan_id, status, review jsonb, review_version int default 0, created_at, updated_at。  
部分唯一：`(contract_id) WHERE status IN ('draft','active','review_ready')`。

#### `continuity_events`

列：id, user_id, aggregate_id, sequence int, type varchar(64), payload jsonb, processed_at, retry_count int default 0, last_error, created_at。  
unique `(aggregate_id, sequence)`。  
部分索引：未消费 `(processed_at IS NULL, created_at)`。

#### `continuity_exposures`

列：id, user_id, candidate_id, surface varchar(32), reserved_at, sent_at, seen_at, handled_at, failed_at, budget_class CHECK `ordinary | work_risk`, period_key varchar(16), outbox_id, created_at。  
索引：`(user_id, period_key, budget_class)`、`(candidate_id, surface)`。

surface CHECK `today | morning_brief | evening_digest | weekly | push`。

#### `continuity_memory_suppressions`

列：id, user_id, topic_fingerprint, evidence_fingerprint, created_at。  
unique `(user_id, topic_fingerprint, evidence_fingerprint)`。

### 3.3 清理

`resetDb()` 在删 `outcomes` / `users` 之前删除全部 continuity 表（先子后父）：

exposures → interventions → experiments → evidence_links → evidence → opportunities → events → memory_suppressions → contract_revisions → contracts → user_settings

`apps/server/scripts/eval/core.ts` 的 `buildSnapshot` 按 `FIXTURE_USER_ID` 同样删除。

`purgeContinuityForOutcome(tx, userId, outcomeId)`：同一事务删除该约定及其子行（settings 除外）。从 `removeAgentOutcome` 调用。暂停/结束不删历史。

### 3.4 DTO

`packages/dto/src/continuity.ts` 并在 `index.ts` 导出。

错误码（`packages/dto/src/errors.ts`）：

- `CONTINUITY_DISABLED` 托管能力未开启
- `CONTINUITY_VERSION_CONFLICT` 约定已被更新，请先同步

JSON 形状：

```ts
cadence:
  | { kind: 'timed'; slots: { weekday: number; startHm: string; durationMin: number }[]; graceHours: number }
  | { kind: 'weekly_count'; count: number; durationMin: number; graceHours: number }

minAction: { title: string; durationMin: number; completionStandard: string }

authorization: {
  readVital: boolean
  prepareMaterials: boolean
  generateDrafts: boolean
  externalSearch: boolean
}
```

默认草案（学习类，PUT 未给字段时）：`weekly_count` count=2、durationMin=20、graceHours=12；authorization 前三项 true，externalSearch false；timezone / weekStartsOn 取用户资料。

接口：

| 方法 | 路径 | body |
|---|---|---|
| GET | `/api/v1/outcomes/:id/continuity` | 无 |
| PUT | `/api/v1/outcomes/:id/continuity` | 草案字段 + optional expectedVersion + optional idempotencyKey |
| POST | `/api/v1/outcomes/:id/continuity/activate` | expectedVersion? + idempotencyKey? + 与 PUT 相同的可选覆盖 |
| POST | `/api/v1/outcomes/:id/continuity/pause` | until?: string ISO, expectedVersion? |
| POST | `/api/v1/outcomes/:id/continuity/resume` | expectedVersion? |
| POST | `/api/v1/outcomes/:id/continuity/end` | expectedVersion? |
| GET/PUT | `/api/v1/continuity/settings` | 设置字段 |

`GET` 响应：

```ts
{
  hosted: boolean
  contract: ContinuityContractSummary | null
}
```

无行：`{ hosted: false, contract: null }`。不要把历史证据塞进该响应。

`expectedVersion` 不匹配 → 409 `CONTINUITY_VERSION_CONFLICT`，body 带当前版本。  
他用户的 outcomeId → 404（与现有 `getOwnedOutcomeOr404` 一致）。  
激活不创建任务。  
同一 outcome 第二次 activate（无论 key）：返回已有 active 约定，不插第二行。  
相同 idempotencyKey 重放：返回原结果。

激活事务：锁 contracts 行（或 outcome 行）→ upsert 容器 → 插入不可变 revision → lifecycle=active → factsVersion++ → 写 event `contract.activated`。不生成 opportunities。

### 3.5 代码放置

```
apps/server/src/db/schema/continuity.ts
apps/server/src/continuity/flag.ts
apps/server/src/continuity/continuity.service.ts
apps/server/src/continuity/continuity.routes.ts
apps/server/src/continuity/purge.ts
packages/dto/src/continuity.ts
packages/api-client/src/domains/continuity.ts
apps/server/__tests__/continuity/continuity.flow.test.ts
```

`app.ts` 注册 `registerContinuityRoutes`。  
api-client：`bindContinuity` 并并入 `createVitalClient`。  
不要加 Web UI、不要改 TodayWorkspace。

### 3.6 测试（必须）

`apps/server/__tests__/continuity/continuity.flow.test.ts`，风格对齐 `energy-logs.flow.test.ts`。

1. 未托管：建 outcome 后 GET `hosted: false`。
2. PUT 草案后 GET 为 draft；不创建 tasks。
3. activate 后唯一容器；再 activate 返回同一 id。
4. 相同 idempotencyKey 重放一致。
5. Bob 用 Alice 的 outcomeId GET/PUT/activate → 404。
6. expectedVersion 错 → 409。
7. 旗标关闭：activate 403；已有约定仍可 GET 与 pause。
8. `removeAgentOutcome` 后该 outcome 的 continuity 行数为 0。
9. 设置 PUT/GET 往返；他用户不可见。

跑：

```
pnpm --filter @vital/dto build
pnpm --filter @vital/api-client build
pnpm --filter @vital/server test __tests__/continuity/continuity.flow.test.ts
pnpm gen:vital-skill
```

服务端 lint/typecheck 至少覆盖改动包。

### 3.7 T1 不要做

- 不要实现机会展开、停滞、候选、通知、实验回顾。
- 不要加 agent job 类型、不要改 worker 扫描。
- 不要加今天页卡片。
- 不要提交 git（用户未要求）。
- 不要重启 production worker；测试库迁移由 vitest 脚本执行。

## 4. 后续包摘要（T1 完成后派工）

### T2 详细规格

纯函数，禁止在 rules 里访问数据库。注入 `now`。T3 再把结果写入 opportunities / evidence_links。

目录：

```
apps/server/src/continuity/rules/types.ts
apps/server/src/continuity/rules/clock.ts
apps/server/src/continuity/rules/opportunities.ts
apps/server/src/continuity/rules/evidence.ts
apps/server/src/continuity/rules/stall.ts
apps/server/src/continuity/rules/recompute.ts
apps/server/src/continuity/rules/index.ts
apps/server/__tests__/continuity/rules.test.ts
```

可复用 `packages/dto` 的 `ContinuityCadence` 与 `localTodayYmd` / `ymdInTimeZone`（`today-briefing.ts`）。时区边界用 luxon。周定义：`weekStartsOn` 1=周一（仓库默认），0=周日。技术方案建议周一至周日；以 revision.weekStartsOn 为准。

#### 机会展开 `planOpportunities`

输入：revision（cadence, timezone, weekStartsOn, activatedAt）、horizonEnd、pauseRanges、existingWindows、now。

- 不追溯 activatedAt 之前的欠账。
- 定时：每个 slot 在当地日生成一条；`startsAt` 为当地 startHm，`endsAt` = start+durationMin，`checkAt` = endsAt+graceHours（默认 12）。`windowKey` = `timed:{localYmd}:{weekday}:{startHm}`。保存 `timezoneSnapshot` 与当地日期。
- 周次数：按完整当地周。激活所在残缺周 `observeOnly=true`，不产生 missed。随后第一个完整周开始判定。`windowKey` = `week:{weekStartYmd}`，`targetCount` = cadence.count，`checkAt` = 周结束瞬间 + graceHours。
- 与 pauseRange 相交的未结束机会 → `exempt`（reason `paused`）。恢复只规划 pause 结束之后的窗口。
- 改节奏：旧 revision 中 `startsAt > now` 的窗口标 `canceled`；不改写已 ended 的历史窗口。
- 时区变更：历史窗口沿用其 `timezoneSnapshot` 判定归属；只按新时区规划未来窗口。

#### 证据归属 `assignEvidence`

只认未撤回、且 `sourceType !== 'agent_prep'`、actor 为 user 或 sourceType ∈ {task_done, habit_checkin, self_report, user_confirm}。

- 同 evidence 对同约定只计一次（已有 unique evidence+contract）。
- 同一行动（sourceType+sourceId+sourceRevision）不能抵两个定时机会。
- 定时：优先明确 binding / 用户指定 opportunityId；仅凭 occurredAt 落在唯一窗口 [startsAt, checkAt] 才自动抵扣；落在多个或零个则不自动抵。
- 周次数：按 occurredAt 的当地日期落入该周，去重后计数。
- 允许晚录入：recordedAt 可晚于 checkAt，仍按 occurredAt 归属。
- 撤销 / supersedes：从有效集去掉被撤回与被替代的，再重算。
- 无节奏愿望（没有 cadence 机会）不判停滞。

#### 停滞 `evaluateStall`

- 定时：两个连续 **有效**（非 exempt/canceled）且 `now >= checkAt` 的机会都无满足标准的证据 → `needs_adjust`。单次错过只标 `missed`，judgement=`watching`。
- 周次数：一个完整周在 checkAt 之后计数 < targetCount → `needs_adjust`（一个未达约周期，不虚构时段）。
- 文案层不在 T2 做；只返回结构化 `StallDecision`：`none | watching | stall`，带 factRefs（opportunity ids + 零进展）。
- 暂停/休假豁免的机会不进入连续计数。

#### `recompute`

纯函数：existing opportunities + evidence + pauseRanges + now + revision → `{ opportunities, links, judgement, stall }`。T3 拿这个 diff 落库。

#### 必测（注入 now，上海时区）

1. 周二、周四定时学习均无记录；周五补记周四 occurredAt → 周四 met、连续停滞不成立，旧 stall 为 none。
2. 每周一次：周中未学不 stall；完整周结束 +12h 才检查。
3. 连续休假两周：窗口 exempt，恢复后从新机会算，不累积欠账。
4. 残缺首周 observe-only。
5. agent_prep / 改标题类证据不计。
6. 用户自报「已经做过」计进展。
7. 同一 source 不重复累计。
8. 定时 occurredAt 落在两个窗口之间无法唯一归属 → 不自动抵。
9. 时区变更不改历史窗口当地日期归属。
10. 改 cadence 取消旧版未来窗口。

不要写 API、不要改 worker、不要改 UI、不要 commit。不要改日程相关已有脏文件。CSI：T2 无 UI；若 :5180 在跑可冒烟 /today，否则跳过。

### T3 详细规格（T2 完成后派工）

把 T2 `recompute` 接到 worker。不实现曝光/通知（T4）和实验（T5）。

新 job 类型 `continuity.recompute`：

- `apps/server/src/db/schema/agent.ts` 的 jobType CHECK 必须同步（另写迁移 `0062_continuity_job.sql`）
- `processors.ts` switch、`scheduler.ts`、`unknown-job-type` 测试三处一起改（P7 教训）
- payload: `{ contractId: string }`
- dedupKey: `continuity.recompute:{contractId}`（upsert 撞车时替换 payload、保留原 job，start 必须复用该 job）
- 不要放进每日全用户扫描；按事件与 `next_check_at` 入队。`DEMAND_ONLY` 或专用 scan 都可以，但每日补扫必须覆盖 `lifecycle in (active,paused)` 且 `next_check_at <= now` 的约定。

事件：T1 已写 `contract.activated` / `contract.draft_saved`。T3 在 pause/resume/end 同样写事件；activate/pause/resume 成功后同事务 `enqueueAgentJob`（禁止 commit 后 fire-and-forget）。

processor：

1. 加载约定+当前 revision+已有 opportunities/evidence/pause
2. 若 `factsVersion` 或 `authorizationVersion` 与 job 记录的不一致，丢弃过期效果并重算
3. 调 `recompute({ now, horizonEnd: now+14d })`
4. 同事务 upsert opportunities（unique contract+revision+windowKey）、写 links、更新 contract.judgement / nextCheckAt / factsVersion
5. 租约丢失抛 `LostAgentJobLeaseError`；过期租约不得落库
6. 不创建 intervention 行（T4）。stall 只体现在 judgement
7. `CONTINUITY_ENABLED=false` 时仍允许 pause 路径入队的 recompute（清理/暂停），但不得跑模型

模型日限额（为 T4/T5 预留）：`continuity_model_eval` 不必新表，用 job dedup `continuity.model:{contractId}:{localYmd}` 原子抢占即可；T3 可以只留 helper `tryReserveDailyModelEval`，真正调模型放到更后。

测试 `__tests__/continuity/recompute-job.test.ts`：

- activate 后 worker 跑完出现未来机会行，`next_check_at` 有值
- 提交后崩溃窗口：事件 unprocessed 时重跑仍幂等
- 暂停后未来机会 exempt/canceled，恢复不补暂停期
- 过期租约不写 judgement
- 旗标关闭不 enqueue 新 activate 的模型评估

改 schema 后不要在本机乱重启 production worker；测试进程自己跑。CSI 同 T2：可选 /today 冒烟。

### T4 详细规格（T3 完成后派工）

把 T2 stall 变成可查询的候选 + 曝光账本 + 可选推送。不做实验（T5）、不做今天页 UI（T6）。

#### 候选写入

在 `processContinuityRecompute` 的 `withAgentJobEffects` 事务末尾（或紧随其后的同一 tx）调用 `syncStallIntervention(tx, ...)`：

- `stall.kind === 'stall'` → upsert `continuity_interventions` kind=`stall_adjust`，status=`open`，factFingerprint = 稳定哈希（排序后的 opportunityIds + revision）。content JSON：`{ facts, whyNow, primaryAction, secondaryActions }`。facts 只用「没有记录」类句子，禁止偷懒/欠账文案。expiresAt = now+7d。唯一键已有部分索引 (contractId, kind, factFingerprint, revision) WHERE open|snoozed。
- stall 不再成立 → 将该约定 open/snoozed 的 stall_adjust 标 `withdrawn`（facts 变了或已补记）。
- 同 fingerprint 已有 open：更新 content，不插第二行，不绕过冷却。
- 不创建 work_risk / explore（P2/P3）。

#### API（DTO 在 packages/dto/src/continuity.ts 扩展）

| 方法 | 路径 |
|---|---|
| GET | `/api/v1/continuity/interventions` 当前用户有效候选（open/snoozed 且未过期），按 tech 排序：P1 只有 stall_adjust。最多 3 条。含 facts / whyNow / primaryAction |
| POST | `/api/v1/continuity/interventions/:id/seen` 幂等 |
| POST | `/api/v1/continuity/interventions/:id/snooze` body `{ until?: ISO }` 默认 +3 天 |
| POST | `/api/v1/continuity/interventions/:id/feedback` body `{ kind: 'done' \| 'adjust' \| 'dismiss' \| 'pause' }` |

seen：写 exposures surface=`today` seen_at；不关候选。  
done：可在 T4 只把候选标 resolved，并留下 TODO 给 T5 写自报证据（若时间够：插 continuity_evidence self_report 再 enqueue recompute）。  
dismiss：status=dismissed。  
pause：调用已有 pauseContinuity。  
跨用户 404。seen 必须幂等。

#### 曝光与预算

`continuity_exposures`：预留/发送/看见/处理。  
普通预算：每用户本地日最多 1 次 push、本地周最多 3 次（budget_class=ordinary）。预留时锁用户 exposures 行或 settings 行，计入 sent+reserved。报告夹带同一 candidateId 视为曝光（T4 若晨报未接，至少在策略函数里留 `wouldExpose(candidateId, surface)` 给晨报调用）。

冷却：同事项 stall_adjust 推送 7 天，以最近 **sent** 为准。新 fingerprint / 改文案不能绕过。  
连续两次真正未响应（过期且从未 handled）：contract.in_app_only_until = now+14d，期间不排 push。  
`in_app_only_until` 未到：GET 仍返回候选，不写 outbox。

#### Outbox

新事件 `agent.continuity`。迁移 `0063_continuity_outbox.sql` 扩展：

- notification_outbox event_type CHECK
- NotificationOutboxPayload.eventType
- dispatch.ts notifyPath → `/today`（或 `/today/threads/{outcomeId}` 若 payload 有 outcomeId）
- catalog-parity / copy maps

payload 只信 candidateId + 版本，不信排队时的长文案。idempotencyKey = `agent.continuity:{candidateId}:{revision}`。entityType=`continuity` 或 `outcome`，entityId=candidateId 或 outcomeId。

发送前（dispatch claim 后、真正 send 前）复核：候选仍 open、未过期、未 withdrawn、约定仍 active、不在安静时段（延后 scheduledAt）、预算仍有效、不在 in_app_only。失败则 cancel outbox，释放 reserved 曝光。

安静时段：复用 `applyQuietHours`。延后跨日后重验预算。

CONTINUITY_ENABLED=false：不 enqueue 新 outbox；GET 候选仍可读。

#### 测试 `__tests__/continuity/delivery.test.ts`

1. 两次有效机会 missed 后 recompute → 一条 open stall_adjust
2. 补记/自报后 recompute → 该候选 withdrawn
3. seen 两次不重复 exposures seen
4. 并发两 worker 预留同一日预算不超过 1
5. 前台 seen 后不再补 push（有 today seen 则跳过 outbox 或取消 pending）
6. 安静时段：outbox scheduledAt 被推迟
7. 跨用户 GET 404

跑 catalog-parity。typecheck。CSI：:5180 /today 冒烟。

不要改 schedule 脏文件。不要 commit。不要做今天页卡片（T6）。

### T5 详细规格（T4 完成后派工）

单事项纠偏实验闭环。不抽跨事项依赖组（T8）。

实验状态：draft → active → review_ready → completed | interrupted | superseded。每约定最多一个 draft/active/review_ready（已有部分唯一索引）。

用户 feedback `adjust`（T4）或独立 POST `/continuity/experiments`：冻结 before 快照（旧 cadence/minAction、有效机会数、真实进展），写入 after 草案，status=active，window = 一个约定周期。基线不足则 baseline 标明 incomparable。

周期结束（T3 recompute 看到 window_end <= now）→ status=review_ready。GET `/continuity/experiments/:id` 返回实际进展、是否达约、数据不足标记。用户完成回顾 → completed。中途 pause → interrupted。再改约定 → superseded。

记忆抑制：删除推断记忆时同事务写 continuity_memory_suppressions（topic+evidence fingerprint）。T5 至少在 `memory.service.ts` delete 路径挂钩；蒸馏写入检查 suppression（若改动面太大，先挂钩 delete + 读取过滤，蒸馏检查可留 TODO 测试锁定接口）。

证据 API：POST `/continuity/evidence` 自报（US-02）。PATCH/DELETE 撤回。写入后 enqueue continuity.recompute。T4 的 feedback=done 应走这条。

测试：同一事项不能两个 active 实验；补记提升 reviewVersion 不改原回顾；pause 中断；删除记忆写 suppression。CSI 冒烟 /today。

### T6 详细规格（T4+T5 完成后派工）

Web 今天页与线程详情。遵循 Emerald Garden / rail-library-canvas。无候选时区域消失。

今天页：`GET /continuity/interventions`，「值得留意」最多 3、默认展开 1。卡片：事实 → 为什么现在 → 一个主按钮。次级：补记、调整、暂停。

线程详情：托管摘要（意义、约定、最近进展、下一步、Vital 在准备什么、下次检查）。按钮：开启托管 / 暂停 / 补记。聊天从线程打开带 outcomeId。

Mutation 后失效 today、thread、interventions query keys。

CSI 必做（session `continuity-t6`），桌面 1280 与移动 375×812：
1. 开启托管（或 API 预置后刷新）
2. 无候选时区域不出现
3. 停滞候选展示「没有记录」+ 最小行动，无羞耻文案
4. 补记后候选消失
5. 暂停后不再出新候选
6. 键盘可操作主按钮

不要做探索独立路由（P3）。发版不 bump web version，除非用户要求发布。

### T7 详细规格（P2）

工作依赖、保护时间、最晚启动风险。不抽跨事项 apply 原子组（T8）。

#### Schema 迁移 `0064_continuity_work.sql`

无外键。加入 resetDb（在 outcomes 之前删）、eval core、`purgeContinuityForOutcome`。

**`continuity_dependencies`**

| 列 | 约束 |
|---|---|
| id, user_id, contract_id | |
| blocked_type | CHECK `task \| outcome` |
| blocked_id | char(36) |
| prerequisite_type | CHECK `task \| outcome \| external` |
| prerequisite_id | 可空；external 为 null |
| external_label | text 可空 |
| status | CHECK `open \| resolved \| canceled` |
| resolved_at, last_user_update_at | timestamptz 可空 |
| revision | int default 0 |
| created_at, updated_at | |

索引：`(user_id, contract_id)`、反向 `(user_id, prerequisite_type, prerequisite_id)`。  
服务层拒绝自环与环路。internal 引用必须同用户且存在。

**`continuity_protected_blocks`**

| 列 | 约束 |
|---|---|
| id, user_id | |
| kind | CHECK `once \| weekly` |
| label | varchar 120，如 家庭 / 休息 |
| timezone | varchar 64 |
| start_at, end_at | once 必填 |
| weekday | weekly 0–6 可空 |
| start_hm, end_hm | weekly `HH:mm` |
| version | int default 1 |
| created_at, updated_at | |

全天保护：once 且日期跨度按当地日占满可工作窗口。普通全天截止任务 **不** 占满一天（沿用 `busyBlock`：isAllDay 不挡）。

可选：`tasks.split_allowed boolean default false`。不可拆分需要连续空档。没有该列则默认不可拆。

#### 纯函数 `apps/server/src/continuity/rules/work-risk.ts`

注入 `now`。**禁止**用 `DEFAULT_SLOT_MINUTES`（30）推断确定延期。

输入：remainingMinutes（仅用户显式估时）、dueAt、workHours、timezone、occupancy 时段、protected blocks、open 依赖、splitAllowed。

输出：

```
{
  kind: 'ok' | 'risk' | 'unconfirmed'
  missing: Array<'estimate' | 'due' | 'dependency_time' | 'calendar'>
  latestStartAt: Date | null
  latestUnblockAt: Date | null
  facts: string[]
  whyNow: string
}
```

- 从 dueAt 向前装箱可工作空档；保护块占用；已占用时段不可被两个承诺共用。
- 缺估时 / 缺截止 / 依赖未知解除时间 → `unconfirmed`，文案「风险待确认」，不说必然延期。
- 已知未完成依赖：计算 latestUnblockAt，不假设届时一定解除。
- `kind=risk` 当 latestStartAt 与 now 之差 < 24h 且估时+截止齐全。

#### API

| 方法 | 路径 |
|---|---|
| GET/POST | `/api/v1/outcomes/:id/continuity/dependencies` |
| PATCH | `/api/v1/continuity/dependencies/:id` 外部条件 resolved / 仍等待 |
| DELETE | `/api/v1/continuity/dependencies/:id` |
| GET/POST/PATCH/DELETE | `/api/v1/continuity/protected-blocks` |

跨用户 404。POST 依赖后 enqueue `continuity.recompute`。

#### 运行时

- `completeTask` / `uncompleteTask` 同事务：内部 prerequisite 完成 → 依赖 resolved 并 enqueue 被阻塞约定；撤销完成 → 重新 open。
- `processContinuityRecompute` 末尾 `syncWorkRiskIntervention`：kind=risk 或 unconfirmed 且值得显示 → upsert `work_risk` 候选（已有 kind CHECK）。facts 变化则旧 fingerprint withdrawn。同风险版本不重复推送。work_risk 可走 T4 的 work_risk 预算例外（不足 24h、每日额外一次、安静时段仍遵守）。若 T4 预算函数只处理 ordinary，为 work_risk 加 `budgetClass: 'work_risk'` 路径，不要拆普通任务提醒额度。
- `listContinuityInterventions` 排序：work_risk 先于 stall_adjust 先于 explore。

#### UI（最小）

线程 `ThreadContinuity` 增加依赖列表：添加内部任务/线程 id 或外部一句话条件；外部「我已更新」；展示「等待你更新」+ last_user_update_at。今天页已有 notice 卡，work_risk 会自然出现。不要新路由。

文案禁止「必然延期」除非 latestStartAt 已过且估时齐全——那时也只说窗口已过，建议下一步。

#### 测试 `__tests__/continuity/work-risk.test.ts`

1. 无估时 → unconfirmed，不出现「延期」
2. 有估时+截止+空档 → 算出 latestStartAt
3. 共享空档被 A 占用后 B 不能再用
4. 全天保护占满；全天 due 任务不占满
5. 依赖完成唤醒；uncomplete 重新阻塞
6. 自环/环路拒绝
7. 跨用户 404
8. 风险解除后 work_risk 候选 withdrawn

CSI session `continuity-t7`：打开一线程，看到依赖区；无风险时今天页不出现伪造延期。旗标仍默认 false。

不要改 `apps/web/src/features/schedule/**`（无关脏文件）。不要 commit。不要做 T8 依赖组 apply。

### T8 详细规格（依赖 T7）

从 `plan.ts` 抽取可接受 `tx` 的领域执行器。preview 带受影响实体版本、保护块版本、**依赖组**（组内全成或全跳过，组间可部分）。应用锁定实体、最终排程重验。A 腾位失败则同组 B 不移入。undo 只逆转仍与应用后版本一致的项。跨事项预览必须展示保护块影响。测试：组跳过、undo 不覆盖后续用户修改、保护块不能被模型取消。CSI：方案卡若有 UI 则走预览文案含保护安排。

### T9 详细规格（P3，可与 T8 并行，但等 T7 合并 schema 后开工以免 resetDb 冲突）

holiday 导入元数据表（source URL、fetchedAt、coverage、version）。`exploration_windows`：稳定 windowKey，连续 ≥2 非工作日，提前 10 天；周末开关默认关、每月最多一次；region 显式，不把表默认 CN 当作用户地区。关闭/休息不重复生成。sourceVersion 更新重算但不绕过去重。API GET windows、POST rest。测试：调休、未知地区、关闭窗口、版本更新。CSI 冒烟。

### T10 详细规格（依赖 T9）

适配器 `search / verifyActivity / weather`，fixture 实现即可（不把 search.all 当互联网）。提案 proposed→selected→…→confirmed。选中重核实；确认才建任务，幂等。核实失败 unknown，用户可明确接受待核实。出发前 24h / 决策截止前检查。90 天 activityKey 拒绝去重。UI 探索详情独立路由。CSI 桌面+移动。

### T11 详细规格

`__tests__/continuity/replay.test.ts` 覆盖 PRD §12.3 能自动化的条目（1–8、11–12 优先；9–10 在 T10 fixture 上）。报告哪些回放仍需人工。不开启生产旗标。

## 5. 现有代码锚点

- 线程：`apps/server/src/db/schema/outcomes.ts`，详情 `getOutcomeDetail`
- 硬删 agent 线程：`apps/server/src/outcomes/remove-agent-outcome.ts`
- 用户设置：`users` 列 + `packages/dto/src/auth.ts` `updateMeInputSchema`（continuity 设置走独立资源，不塞爆 `/me`）
- 路由注册：`apps/server/src/app.ts`
- 测试清理：`apps/server/__tests__/helpers/db.ts`
- eval 清理：`apps/server/scripts/eval/core.ts`
- 计划方案：`apps/server/src/agent/chat/tools/plan.ts`（T5/T8 再抽 tx 执行器）
- 通知：`apps/server/src/notifications/dispatch.ts`（T4）
- 记忆：`apps/server/src/agent/memory.service.ts`（T5）
- 今天页：`apps/web/src/features/today/`（T6）
- 无功能旗标先例：用 `AGENT_ENABLED` 同款 env
- 部分唯一索引先例：`agent_chat_conversations_active_uidx`
- 幂等先例：`inbox_items_user_idempotency_uidx`
