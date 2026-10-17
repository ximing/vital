# Personal Agent 任务计划

对应需求：`docs/personal-agent-prd.md`（2026-10-15）
迁移起始号：0052（当前最新 0051_task_calendar_key）
排期原则：先主动性（体感最快），再委派（价值最深），最后用户模型（需要数据积累）。每批次独立可交付、可验收、可上线。

## 批次总览

| 批次 | 内容 | 需求 | 依赖 |
|---|---|---|---|
| P1 | 晨报推送 | A1 | 无 |
| P2 | 晚报智能化 | A2 | 无 |
| P3 | defer 追问 → chat | A3.2 | 无 |
| P4 | 会前准备卡 | A3.1 | 检索基建（已有） |
| P5 | 每周静默洞察 | A4 | P2（复用周报事实层） |
| P6 | chat 多步委派 | B1 | 无 |
| P7 | 数字任务代办 | B2 | P6（复用方案-确认链路） |
| P8 | 日程代排提案 | B3 | P1（简报协同）、P9 画像可后接 |
| P9 | 节奏画像 | C1 | 数据积累 ≥2 周 |
| P10 | 精力/状态轴 | C2 | 无 |
| P11 | 目标贯穿 | C3 | P5（周报洞察区） |

P1–P5 是主动性线，P6–P8 是委派线，P9–P11 是用户模型线。三条线可并行，线内按序。

---

## P1 晨报推送（A1）

**改动点**

1. 迁移 0052：`users` 加 `notify_morning_brief boolean not null default true`；`notification_prefs` DTO 加 `morningBrief` 字段与开关（`packages/dto/src/notifications.ts`）。
2. 新文件 `apps/server/src/notifications/morning-brief.ts`：
   - `enqueueMorningBriefs(now)`：按用户时区计算本地 07:30（可配），每人每天一条 outbox 行，`eventType: 'agent.briefing'`，idempotencyKey = `agent.briefing:{user}:{day}`。模式照抄 `evening-digest.ts`。
   - 遵守安静时段（applyQuietHours）。
3. dispatch 侧：`agent.briefing` 的 payload 在投递前由 LLM 生成正文（capability `agent.briefing`，登记成本路由）；模型不可用退化为结构化模板文案。事实层复用 today 简报的 buildTodayPlan 数据 + meetings + 天气缓存。
4. 「今天页已打开则当天不推」：outbox 行投递前检查 today.layout 上报上下文里今日是否已有页面活跃记录；简化为「简报生成时刻若 30 分钟内有过 today 上下文上报则跳过」。
5. 设置页：通知偏好加「晨报」开关与时刻。
6. 落地页：推送点击 URL 指向 `/today`。

**测试**：规则层单测（时刻计算、幂等、安静时段、跳过逻辑）；flow 测试（enqueue → dispatch → 渠道）；模型关闭时发模板文案。

**验收**：csi 造数（逾期任务 + 日程），07:30 档位收到晨报，文案含空档建议；开关关闭后不发。

## P2 晚报智能化（A2）

**改动点**

1. `evening-digest.ts` 文案升级：dispatch 时的事实收集从「数未处理任务」扩展为：今日完成数、outcome 进展（今日有活动的）、连续 defer 候选一件、明日第一件建议。
2. LLM 润色走 insights 的 rewrite 模式：规则文案先落 outbox payload（崩溃兜底），投递前模型改写，失败发规则版。
3. 全部完成/无活动分支：全部完成 → 肯定 + 明日建议；当天零活动 → dispatch 时丢弃该行（不发）。
4. capability 沿用 `agent.notify`，成本观测不变。

**测试**：三个分支（有遗留/全完成/零活动）单测 + flow。

**验收**：csi 三种状态各验一次；零活动日确认无推送。

## P3 defer 追问 → chat（A3.2）

**改动点**

1. insights.ts：`task.decompose` 候选文案改为问句（「是不要做了，还是卡在哪？」），payload 里带 `taskId` 与 `deeplink: /chat?task=<id>`。
2. web：通知点击落到 agent-chat 并带任务上下文预填（chat 已有任务上下文能力则复用，没有则加 `contextTaskId` 入参）。
3. chat 追问应答映射：识别「不做了 / 下周再说 / 帮我拆」三意图 → tasks.patch(cancel) / tasks.patch(defer) / enqueueAgentJob(task.decompose, manual)。用现有工具实现，不加新工具。
4. 防抖：agent_actions 记录追问动作，同一任务 7 天内不再出候选（factsFor 里排除）。

**测试**：insights 候选防抖单测；chat 意图映射 flow 测试。

**验收**：csi 造 defer≥3 任务，收推送 → 点击进 chat → 三种回答各验一次。

## P4 会前准备卡（A3.1）

**改动点**

1. 调度：worker 轮询（或日历同步入库时触发）找「15 分钟后开始」的 calendar 来源任务，幂等键 = `meeting.prep:{taskId}:{startAt}`。
2. 匹配：检索基建（embedding 相似 + 标题词）找相关任务/inbox 条目；0 命中则不推。
3. 在线路径：browser-notify / sticky 弹窗；离线走 push。outbox payload 带相关条目 id 列表，点击落到今天页 meetings 模块锚点。

**测试**：匹配命中率单测（固定 fixture）；幂等与「无匹配不推」flow。

**验收**：csi 造 15 分钟后会议 + 相关任务，确认推送与落地锚点。

## P5 每周静默洞察（A4）

**改动点**

1. 新 job 类型 `reflect.weekly`（加入 agent_jobs CHECK 枚举与调度器），每周一次跟随用户周报日。
2. 聚合统计输入（深夜建任务数、inbox 未读主题聚类、打卡时间漂移、defer 主题），产出 0–2 条洞察；capability `agent.observe`。
3. 出口双写：outbox 推送 + 当周周报 body 洞察区。
4. 无模式不产出不推送。

**测试**：聚合统计单测（固定数据出固定模式）；「无模式静默」用例。

**验收**：csi 造一周深夜任务数据，周日档位收到洞察推送，周报出现洞察区。

## P6 chat 多步委派（B1）

**改动点**

1. registry 闸门改造：`gate.mutated` 单次限制 → 方案-确认两段式。mutate 工具在「方案模式」下不直接生效，累积成方案。
2. 新工具 `tasks.propose_plan`（mutate 类，但不立即生效）：提交批量变更方案（≤20 条 patch），返回 previewId；前端渲染方案卡（逐条 diff：标题/日期/优先级/归属的旧值→新值）。
3. 新端点 `POST /api/v1/agent/plans/:id/apply`：单事务应用全部变更，逐条 revision 校验，冲突条目跳过并汇报；写 agent edit events（undo 链路复用）；15 分钟有效期。
4. loop 上限：单次会话工具调用 ≤ 12 步，方案内变更 ≤ 20 条，成本过 model-budget。
5. undo：应用后 toast/横幅给撤回窗口（复用批次1的 undo 基建）。

**测试**：方案生成/过期/revision 冲突/部分跳过/undo 全链路 flow；闸门改造回归（单 mutate 直改场景不变）。

**验收**：csi「帮我排下周三前的任务」→ 方案卡 → 确认 → 任务批量变更 → 撤回。

## P7 数字任务代办（B2）

**改动点**

1. 新 job 类型 `errand.run`（CHECK 枚举、调度、成本）。
2. 两类 errand：
   - `inbox.read_summarize`：读 content_json → 三行摘要写条目摘要位 → 关联任务标完成。
   - `inbox.organize`：批量归档/打标签 → 整理说明。
3. 入口：chat（「帮我读这篇」）+ inbox 条目「让 agent 读」按钮 + task.draft 可自动执行升级入口。
4. 结果：agent_actions 记录 + 任务 notes 追加 + 完成汇报通知（复用 outbox，`agent.errand` eventType）。
5. 失败路径：正文缺失/模型不可用 → 任务不标完成，notes 附原因。
6. 成本上限：单 errand ≤ 3 次模型调用，超出降级为提案。

**测试**：两类 errand 的成功/失败/降级 flow；幂等（重复跑不重复写摘要）。

**验收**：csi 转存一篇文章 → 「让 agent 读」→ 摘要出现、任务完成、收到汇报。

## P8 日程代排提案（B3）

**改动点**

1. 设置项：工作时段（默认 09:00–18:00）、单日时间盒上限。
2. 排程器（纯函数）：开放任务（有 estimateMinutes）× 日历占用（calendar_key 任务的 startAt/dueAt）× 工作时段 → 空档分配。排不下明确报「排不下」。
3. 提案卡复用 P6 方案-确认链路：确认后批量写 startAt/dueAt，任务行标「agent 排的」。
4. 简报协同：今天页 focus 模块优先展示已排时间盒任务（today.layout 事实层加字段）。
5. v1 不回写系统日历（架构红线）。

**测试**：排程纯函数单测（空档切割、冲突、排不下）；与 P6 链路集成 flow。

**验收**：csi 造日历占用 + 3 个估时任务 → 提案卡 → 确认 → 任务带时段出现在 focus。

## P9 节奏画像（C1）

**改动点**

1. memory.distill 加蒸馏目标 `profile.rhythm`：输入 task_completions 时间分布、defer 记录、habit 打卡时间；样本 < 2 周不产出。
2. 画像存 agent_memory scope=profile，带样本量与生成时间。
3. 消费：today.layout prompt 注入画像（高效时段影响模块排序）；晨报文案引用；P8 排程优先高效时段。
4. 设置页「它眼中的你」区块：画像条目列表 + 删除（删除后蒸馏不再生成同类——蒸馏 prompt 读删除记录）。

**测试**：蒸馏输入/样本门槛单测；设置页删除后的再生抑制。

**验收**：有 2 周数据的 dev 账号看设置页画像出现；晨报文案引用画像。

## P10 精力/状态轴（C2）

**改动点**

1. 迁移 0053+：`energy_logs` 表（id、user_id char(36) 无外键、energy smallint 1–5、mood text nullable、note text nullable、logged_at、created_at）；resetDb/eval fixture 登记。
2. API：POST /api/v1/energy-logs、GET 按日查询；sync 通道纳入（或独立轻同步）。
3. web 今天页 + 移动端：一键录入组件（1–5 精力 + 可选情绪词）；days 时间轴展示记录。
4. 关联分析入 `reflect.weekly` 输入（精力 vs 次日完成率），样本不足不下结论。
5. 晨报/晚报语气：当日有低精力记录时降载建议。

**测试**：API flow；一周关联统计单测。

**验收**：csi 录入 → days 时间轴出现 → 次日晨报降载语气。

## P11 目标贯穿（C3）

**改动点**

1. 里程碑：tasks 加 `is_milestone boolean not null default false`（迁移，含在 P11 批次号内），或复用排序位——实现时二选一，倾向加列。任务编辑 UI 加「里程碑」开关（outcome 归属任务才有意义）。
2. outcome.refresh 升级：headline 带「3/5 里程碑」进度；ruleSignal 计算纳入里程碑完成度。
3. reflect.weekly：ruleSignal=alert 的 outcome 产出一句话追问，入周报洞察区。
4. 周报 body 加「按目标」段落：每个 open outcome 一段（进展 + 下周一步）；daily report 不动。

**测试**：里程碑计数与信号计算单测；周报段落 flow。

**验收**：csi 造 outcome + 里程碑任务 → 完成部分 → outcome 卡显示进度、周报出现「按目标」段。

---

## 全局落地约束（每批次都要过）

- 新表无 FK；跨表写单事务；resetDb() 与 eval fixture 登记新表。
- 新 job 类型同步三处：`agent_jobs` CHECK 枚举、processors.ts dispatch、调度器（scheduler.ts）。
- 新 capability 登记 LLM 路由与 perCapability 成本；budget 熔断路径有测试。
- schema 变更后重启 worker 再验收。
- 每批次结束：版本号 bump（apps/web/package.json）、csi 验收记录、记忆写入 agent-recall（architecture/bug/lesson）。
- 风险位：P6 的闸门改造触碰 chat 核心链路，回归面最大，单独一批不夹带其他改动。
