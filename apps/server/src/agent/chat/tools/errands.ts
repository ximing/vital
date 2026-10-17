import { Type } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { startOrganizeErrand, startReadErrand } from '../../errand.js';
import { register } from '../registry.js';
import { needsInput, okResult, type ToolResult } from '../types.js';

const readInput = z.object({
  inboxItemId: z.string().uuid().optional(),
});

const organizeInput = z.object({
  inboxItemIds: z.array(z.string().uuid()).min(1).max(80),
});

register({
  name: 'errands.read',
  label: '让 agent 读',
  description:
    '把一篇收集箱交给后台读完并写三行摘要。用户说「帮我读这篇」时调用。inboxItemId 省略时用当前打开的收集箱。不要自己写摘要。',
  parameters: Type.Object({
    inboxItemId: Type.Optional(Type.String({ description: '收集箱条目 id。省略则用当前页面。' })),
  }),
  input: readInput,
  mode: 'mutate',
  handler: async (ctx, input): Promise<ToolResult> => {
    const inboxItemId = input.inboxItemId ?? ctx.page.inboxId ?? undefined;
    if (!inboxItemId) return needsInput('先打开一篇收集箱，或告诉我是哪一篇。');
    const started = await startReadErrand(ctx.userId, inboxItemId, 'chat');
    return okResult('已交给后台阅读，做完会通知。', started, ['inbox', 'tasks']);
  },
});

register({
  name: 'errands.organize',
  label: '整理收集箱',
  description:
    '把若干收集箱条目交给后台归档或打标签。inboxItemIds 是条目 id，最多 80 个。不要自己改这些条目。',
  parameters: Type.Object({
    inboxItemIds: Type.Array(Type.String(), { minItems: 1, maxItems: 80, description: '要整理的收集箱条目 id' }),
  }),
  input: organizeInput,
  mode: 'mutate',
  handler: async (ctx, input): Promise<ToolResult> => {
    const started = await startOrganizeErrand(ctx.userId, input.inboxItemIds, 'chat');
    return okResult(`已交给后台整理 ${String(input.inboxItemIds.length)} 篇，做完会通知。`, started, ['inbox', 'tasks']);
  },
});
