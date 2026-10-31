# Personal Agent Continuity — PRD §12.3 回放

自动化入口：`apps/server/__tests__/continuity/replay.test.ts`。  
生产旗标 `CONTINUITY_ENABLED` 保持默认 **false**，本回放不开启。测试内用 `setContinuityEnabledForTest(true)` 造数，用完恢复。

## 1–12

| # | PRD 条目 | 本文件 | 其它覆盖 | 人工 |
|---|---|---|---|---|
| 1 | 周二、周四无记录，周五补记周四：计数重算，旧候选失效 | 跑：补记后 Thursday `met`，stall `withdrawn` | `rules.test.ts` 纯函数；`delivery.test.ts` / `experiments.test.ts` 自报撤候选 | 否 |
| 2 | 每周一次：周中不停滞；周期结束按规则检查 | 跑：周三 `open` 无 stall；grace 后 `missed` + stall | `rules.test.ts` weekly_count | 否 |
| 3 | 连续休假两周：不欠账，恢复从新机会计算 | 跑：pause 两周后 WEEK_1/2 `exempt`，WEEK_3 `open`，resume 无 `missed` | `rules.test.ts` pause；`recompute-job.test.ts` pause/resume 不重复窗口 | 否 |
| 4 | 修改计划后旧 job 返回：不写入新版本，不产生旧提醒 | 跑：revision bump 取消未开始旧窗口；`appliedGeneration` 命中则不改写 | `rules.test.ts` cadence change；`recompute-job.test.ts` 租约 | 否 |
| 5 | 同时工作风险、学习调整、探索候选：排序聚合，不各发一次 | 跑：`listContinuityInterventions` 顺序 `work_risk` → `stall_adjust` → `explore`；ordinary push 1 + work_risk extra 1，explore 不占第三条 | `work-risk.test.ts` 单类排序；`delivery.test.ts` ordinary 日预算 | 否 |
| 6 | 无运动记录但说明线下完成：接受自报，不要求设备证明 | 跑：`self_report` 无 device 字段，Thursday `met` | `experiments.test.ts` / `delivery.test.ts` 自报 | 否 |
| 7 | 用户说刷视频、未授权设备：只用该次自述，不声称监测 | 跑：证据 body 为用户原句；stall facts 仍「没有记录」，无「监测到刷视频」 | `delivery.test.ts` 羞耻文案不含「刷视频」（未覆盖用户自述） | 否 |
| 8 | 生成学习资料成功：只标准备，不标用户已学会 | 跑：`agent_prep` 不把窗口标 `met`，stall 仍「没有记录」 | `rules.test.ts` agent_prep 纯函数 | 否 |
| 9 | 假期显示休假但有工作安排：避冲突，不强行出行 | 部分跑：调休 `workday` 不纳入 holiday 窗口。**skip**：任务占用未接入 `generateExplorationWindows` | `exploration-windows.test.ts` 调休 / 未知地区 | **真实假期、真实工作占用** |
| 10 | 活动取消或天气变化：撤回旧建议并给替代，不推荐失效活动 | 跑：天气 `changed` 不自动改任务（与 `exploration-verify.test.ts` 同断言） | `exploration-verify.test.ts` | 否 |
| 11 | 删除事项时准备任务在跑：无孤立通知、无越权落地 | 跑：`removeAgentOutcome` 清干预；pending `agent.continuity` 派发后 `cancelled`，不能 `sent` | `continuity.flow.test.ts` purge 行数 | 否 |
| 12 | 模型熔断：基础状态与暂停可用，规则反馈可理解，不伪造智能分析 | 跑：`CONTINUITY_ENABLED=false` 时 GET/pause 200，activate 403，recompute 不新增 outbox | `continuity.flow.test.ts` / `recompute-job.test.ts` 关旗标 | 真实模型熔断需人工 |

## 仍需人工

- **四周观察**（PRD §12.1）：停滞后恢复率、恢复耗时、建议有效性、无效打扰、工作风险价值、探索价值。单用户样本，不由本回放推断效果。
- **真实假期**：日历休假日上已有工作任务时，是否避免出行建议。窗口规划尚未读取任务 occupancy。
- **真实模型熔断 / 供应商故障**：本回放用旗标关闭代替；不伪造智能分析。

## 旗标

`apps/server/src/config.ts`：`CONTINUITY_ENABLED` 默认 `false`。不要为了回放打开生产旗标。
