import type { AgentJobRow, User } from '../db/schema.js';
import { enqueueProactiveInsights } from '../notifications/insights.js';
import { executionResult } from './executions.service.js';
import { loadAgentMemory, runProposalPass } from './harness.js';
import type { AgentJobResult } from './processors.js';
import { submitNotificationTool, type SubmitNotificationArgs } from './tools.js';

export async function processNotifyScan(
  _job: AgentJobRow,
  user: User,
  now: Date,
): Promise<AgentJobResult> {
  const inserted = await enqueueProactiveInsights(user, now, async (item) => {
    const memory = await loadAgentMemory(user.id, 'notify', item.message);
    const result = await runProposalPass<SubmitNotificationArgs>({ user, capability: 'agent.notify', systemPrompt: '你为个人任务系统写一句简短、温和、可行动的手机提醒。不得添加事实。必须调用 submit_notification。', userPrompt: `规则提醒：${item.message}\n长期偏好：${memory.map((m) => m.content).join('；')}`, makeTool: submitNotificationTool });
    if (!result) return null;
    return result.args.message;
  });
  executionResult({ resultSummary: `已安排 ${String(inserted)} 条提醒`, inputSummary: '仅检查当前用户的任务、线程、习惯与复盘' });
  return 'done';
}
