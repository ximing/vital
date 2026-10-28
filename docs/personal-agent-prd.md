# Personal Agent 需求文档

版本：v1（2026-10-15 定稿）
状态：待评审
范围：主动性、委派执行、用户模型三个方向。邮件接入、网页监控、健康数据、位置触发不在本期。

## 背景

Vital 的 agent 目前更像"后台清洁工"：排简报（today.layout）、归簇任务（outcome.cluster）、提拆解建议（task.decompose）、写日报（report.generate）。它很少主动来找用户，也从来没有"替你办完一件事"。本期的目标是把体感从「工具里有 AI」推到「有个懂我的助理在盯着」。

## 现有基建（可复用，不重造）

| 能力 | 现状 |
|---|---|
| 通知链路 | `notification_outbox` 表 + outbox dispatch，幂等键、定时投递、安静时段（quiet-hours）都已实现 |
| 通知渠道 | meow、华为 push、浏览器/桌面原生通知、桌面 sticky 弹窗 |
| 洞察 | `notifications/insights.ts` 规则候选（outcome.stale / task.decompose / habit.window / review.missing）+ 可选 LLM 润色，`notify.scan` job 驱动 |
| 晚间提醒 | `evening-digest.ts`，21:00 发「今天还有 N 件没处理」（纯计数器，无智能） |
| Agent job 框架 | `enqueueAgentJob` / `enqueueAgentJobOnce`、dedupKey、租约心跳、退避重试、`withAgentJobEffects` 单事务生效 |
| Chat 工具 | 12 个工具（读 today/tasks/habits、search.all、建/改/完成任务、习惯、tasks.organize 批量整理），带 preview/undo |
| Chat 闸门 | 一轮对话只允许一次 mutate（registry.ts gate），批量只能走 tasks.organize |
| 记忆 | agent_memory 表 + memory.distill 蒸馏 + 按 scope 注入 prompt |
| 目标 | outcomes 表有 ruleSignal/ruleNextStep/agentHeadline/agentSuggestion/lastActivityAt，outcome.refresh 定期刷新 |
| 日历 | 本地日历单向同步成任务（calendar_key）。今天页不再单独展示日程模块 |
| 成本 | 每次模型调用有 telemetry 和 perCapability 摊销成本，model-budget 可熔断 |

## 需求 A：主动性——从"你问它答"到"它来找你"

### A1 晨报推送（Morning Briefing）

**用户故事**：每天早上打开电脑前，手机/桌面收到一条晨报，不是列表复读，而是有判断的一天开局。

**行为**：
- 每个用户本地时间固定时刻（默认 07:30，可改）触发一次，走 `notification_outbox` 定时投递，遵守安静时段。
- 内容来源：今日日程（meetings）、逾期任务、标了优先级的任务、日程空档分析、天气。与今天页简报共用事实层（buildTodayPlan 同款数据），但晨报可以**给建议**：「3 个会中间只有 1 小时空档，X 建议挪到明天」。
- 文案由 LLM 生成（新 capability `agent.briefing`），规则文案兜底；模型不可用时退化为结构化模板，**不能不发**。
- 一天最多一条。dedupKey 按用户+本地日。用户在前台打开过今天页则当天不再推（避免重复体感）。
- 推送点击落地到今天页。

**边界**：没有日程也没有逾期时晨报要短，一句「今天 N 件，没有逾期」即可，不为凑内容编建议。遵循用户通知偏好，新增独立开关 `notifyMorningBrief`。

### A2 晚报升级（Evening Review）

**用户故事**：晚上收到的不是「还有 N 件没处理」这种施压计数器，而是有温度的一天收口。

**行为**：
- 替换现有 `evening-digest` 的纯计数文案。保留 21:00 时刻与幂等键规则（一个用户一天一条）。
- 内容：今天完成了几件、哪个 outcome 有进展、一件值得放下的（连续 defer 的任务）、一句收口判断。
- 全部完成时不数落用户，改为肯定 + 明日第一件事建议。
- 今天没任何活动时**不发**（不打扰比尬聊重要）。
- LLM 润色复用 insights 的 rewrite 模式：规则候选先入 outbox 作崩溃兜底，模型改写失败发规则版。

### A3 事件驱动的主动介入

**A3.1 会前准备卡**
- 日历同步进来的任务（calendar_key 来源）开始前约 15 分钟，若今天页/桌面在线，推送「这个会的相关任务和笔记」：标题含共同词的任务、同 outcome 的进行中任务、最近相关 inbox 条目。
- 复用检索基建（embedding 相似 + 标题词匹配），匹配不到就不推。
- 浏览器在线时走 browser-notify；不在线时走 push 渠道。幂等键 = 日程任务 id + 开始时刻。

**A3.2 defer 追问**
- 现有 task.decompose insight 在 defer 达到阈值时提拆解。升级为**对话式追问**：推送/简报里的文案从「要不要拆」变成「是不要做了，还是卡在哪？点这里告诉它」。
- 点击落到 agent-chat 并预填该任务上下文；用户在 chat 里的一句话回答（"不做了" / "下周再说" / "帮我拆"）直接映射为 cancel / defer / 触发 task.decompose job。
- 追问过一次的任务 7 天内不再追问（防抖存入 agent_actions 或 insight 记录）。

### A4 每周静默洞察（Weekly Observer）

**用户故事**：周末收到一条"它一直在观察我"的洞察，而不是又一份清单。

**行为**：
- 新 job 类型 `reflect.weekly`，每周一次（跟随用户周报日，默认周日傍晚）。
- 从一周数据里找**模式**，不是汇总：深夜建任务的频次、inbox 未读囤积的主题聚类、习惯打卡时间的漂移、defer 最多的任务类型。
- 最多产出一到两条，没有模式就不发。文案示例：「这周晚上 11 点后建了 7 个任务——是不是焦虑性记录？」
- 走 outbox + 也写入当天/当周周报 body 的洞察区。
- 新 capability `agent.observe`，输入是聚合统计（不是原始清单），控制 token 成本。

## 需求 B：委派执行——从"提案"到"代办"

### B1 Chat 多步委派

**用户故事**：对 chat 说「帮我把下周三前要做的事理出来排个序」，它读任务和日历，给出一个方案卡，我说「就这么办」，它批量改完并回报。

**行为**：
- 解开"一轮一次 mutate"的闸门：改为**方案-确认两段式**。agent 产出一份变更方案（批量 patch 列表），前端渲染成方案卡（每条变更可预览 diff），用户点确认后由服务端在**一个事务**里应用全部变更。
- 复用 tasks.organize 的批量语义，但方案由多轮推理产出（可读多次、再产出方案），不只一轮。
- 方案卡有有效期（15 分钟）和快照校验：应用时逐条检查任务 revision，被外部改过的条目跳过并汇报。
- 全部变更可 undo：复用 agent edit events / undo 链路，方案应用后给一次撤回窗口。
- loop 的步数、工具调用次数、单方案变更条数（上限 20）都要有硬上限，成本走 model-budget。

**边界**：方案只覆盖 tasks 域（优先级、日期、状态、outcome 归属）。不删任务，不碰 habit 定义。

### B2 数字任务代办（Agent Errands）

**用户故事**：「读这篇 inbox 文章并总结」「把这几篇转存归档」这类数字世界内的任务，agent 直接做完，只汇报结果。

**行为**：
- 新 job 类型 `errand.run`。入口：chat 里说「帮我读一下这篇」、inbox 条目上的「让 agent 读」按钮、或 task.draft 判定为可自动执行的草案升级。
- v1 只支持两类 errand：
  1. **读并总结**：读 inbox_item_bodies 的 content_json，产出三行摘要写入条目摘要位，任务标完成。
  2. **归档整理**：按标签/主题把一批 inbox 条目移动/标记，产出整理说明。
- 结果落在 agent_actions（可追溯）+ 任务 notes + 一条完成汇报通知。
- 失败（正文缺失、模型不可用）时任务不标完成，附失败原因回到用户手里。
- 成本上限：单次 errand 模型调用 ≤ 3 次，超出降级为提案（回到人工）。

### B3 日程代排（Auto-scheduling，提案层）

**用户故事**：「明天上午帮我安排写方案的时间」——agent 在日历空档里放时间盒提案，我确认后任务有了时间。

**行为**：
- v1 **只做提案，不回写系统日历**（日历同步是单向的，这是既定架构）。
- 输入：有 estimateMinutes 的开放任务 + 日历同步来的占用时段 + 用户偏好工作时段（新增设置项，默认 09:00–18:00）。
- 产出：时间盒提案卡（任务 × 建议时段），确认后把任务的 startAt/dueAt 设为提案时段。任务行显示「agent 排的」。
- 与 today.layout 协同：排了时间盒的任务在简报 focus 模块优先。
- 排程冲突、空档不足时明确说「排不下」，不硬塞。

## 需求 C：用户模型——从"记碎片"到"懂你"

### C1 节奏画像（Rhythm Profile）

**用户故事**：简报和晨报不再千篇一律，它知道我上午效率高、周四容易崩。

**行为**：
- memory.distill 升级：新增蒸馏目标 `profile.rhythm`，从 task_completions 时间分布、defer 模式、habit 打卡时间学出结构化画像：高效时段、低效 weekday、平均任务粒度、defer 高发主题。
- 画像存 agent_memory（scope=profile），有生成时间和依据样本量；样本不足（<2 周数据）时不产出不臆测。
- 消费方：today.layout（模块排序参考高效时段）、晨报文案（建议时段时引用画像）、B3 代排（优先高效时段）。
- 设置页可见可改：「它眼中的你」区块，画像条目可删除（删除后不再生成同类）。

### C2 精力/状态轴（Energy Log）

**用户故事**：一键记下现在的状态和精力，agent 把它和完成率关联起来，状态差的日子主动降载。

**行为**：
- 新实体：状态记录（精力 1–5 + 可选情绪词 + 可选一句话），今天页和移动端一键录入，一天可多条。
- 新表（无外键，user_id char(36)）。记录进 days 时间轴展示。
- 关联分析并入 `reflect.weekly`：「睡眠不足（你自己记的）之后的第二天完成率降 40%」这类因果观察，样本不足不下结论。
- 当天有低精力记录时，晚报/晨报语气降载：「今天状态一般，X 可以挪」。

### C3 目标贯穿（Outcome 2.0 轻量版）

**用户故事**：outcome 不只是任务容器——有里程碑、有进度感，agent 每周追问，周报按目标组织。

**行为**：
- outcomes 加里程碑：轻量实现为 outcome 下的「里程碑任务」标记（复用现有任务，加 `milestone` 标记或排序位），不新建实体。
- outcome.refresh 升级：进展判断从 lastActivityAt 信号升级为「里程碑完成度 + 活动信号」，headline 里体现进度感（「3/5 里程碑」）。
- 每周追问：reflect.weekly 里对 ruleSignal=alert 的 outcome 产出一句话追问，进周报洞察区。
- 周报（weekly report）新增「按目标」段落：每个 open outcome 一段（进展 + 下周一步），替代部分按清单罗列的内容。daily report 不变。

## 全局约束

- 所有新表无 PostgreSQL 外键；跨表写入单事务；resetDb / eval fixture 同步登记。
- 所有新 job 类型接入 agent_jobs 的 CHECK 约束枚举、调度器、成本观测。
- 所有新 LLM 能力登记 perCapability 成本与 budget 熔断；模型不可用时一律有规则兜底或明确 skip。
- 推送类功能全部过安静时段；所有新通知类型在设置页有独立开关。
- 涉及 schema 变更后重启 worker 才算生效（tsx watch 不覆盖 worker）。

## 验收总标准

1. 每个需求有服务端单测（规则层）+ flow 测试（job → outbox → dispatch）。
2. 每个用户可见功能过 csi 验收（web；移动端视范围真机验收）。
3. 晨报/晚报/洞察在模型关闭时行为符合兜底约定。
4. 成本：单用户每日 agent 模型调用成本在现有 budget 档位内可观测、可熔断。
