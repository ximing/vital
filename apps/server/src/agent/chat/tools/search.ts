import { Type } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { listOutcomes, getOutcomeDetail } from '../../../outcomes/outcomes.service.js';
import { searchAll } from '../../../retrieval/search.js';
import { register } from '../registry.js';
import { normName } from '../resolve.js';
import { needsInput, okResult, toolError, type ToolResult } from '../types.js';

const searchInput = z.object({
  q: z.string().trim().min(1).max(100),
});

const detailInput = z.object({
  outcomeId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

function clip(value: string | null, max = 160): string | null {
  if (value === null) return null;
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

register({
  name: 'search.all',
  label: '搜索',
  description: '搜索任务、线程和收集箱标题。不要用它读取文章正文。',
  parameters: Type.Object({
    q: Type.String({ minLength: 1, maxLength: 100 }),
  }),
  input: searchInput,
  mode: 'read',
  handler: async (ctx, input): Promise<ToolResult> => {
    let results: Awaited<ReturnType<typeof searchAll>>;
    try {
      results = await searchAll({ userId: ctx.userId, q: input.q, limit: 5 });
    } catch {
      return toolError('SEARCH_UNAVAILABLE', '搜索暂时不可用。');
    }
    if (results === null) return needsInput('搜索还没准备好。');
    return okResult(`「${input.q}」的搜索结果`, {
      tasks: results.tasks.slice(0, 5),
      outcomes: results.outcomes.slice(0, 5),
      inbox: results.inbox.slice(0, 5).map((item) => ({ ...item, excerpt: clip(item.excerpt) })),
    }, []);
  },
});

register({
  name: 'outcomes.detail',
  label: '看线程',
  description: '只读一个线程的名字、信号、关联待办标题和习惯标题。不要索要资料正文。',
  parameters: Type.Object({
    outcomeId: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
  }),
  input: detailInput,
  mode: 'read',
  handler: async (ctx, input): Promise<ToolResult> => {
    let outcomeId = input.outcomeId ?? ctx.page.outcomeId ?? undefined;
    if (!outcomeId && input.name) {
      const rows = await listOutcomes(ctx.userId, { status: 'open' });
      const hits = rows.filter((row) => normName(row.name) === normName(input.name ?? ''));
      if (hits.length === 0) return needsInput(`没有叫「${input.name}」的线程。`);
      if (hits.length > 1) return needsInput(`有多个线程叫「${input.name}」。`);
      outcomeId = hits[0]?.id;
    }
    if (!outcomeId) return needsInput('要说清是哪个线程。');
    const detail = await getOutcomeDetail(ctx.userId, outcomeId);
    return okResult(detail.outcome.name, {
      id: detail.outcome.id,
      name: detail.outcome.name,
      signal: detail.outcome.ruleSignal,
      next: detail.outcome.ruleNextStep,
      headline: detail.outcome.agentHeadline,
      tasks: detail.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
      habits: detail.habits.map((habit) => ({
        id: habit.id,
        name: habit.name,
        todayDone: habit.todayDone,
        todayTotal: habit.todayTotal,
      })),
    }, []);
  },
});
