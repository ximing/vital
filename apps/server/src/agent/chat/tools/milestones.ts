import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from '@earendil-works/pi-ai';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { runProposalPass } from '../../harness.js';
import { getUserEntity } from '../../../auth/auth.service.js';
import { getDb } from '../../../db/index.js';
import { tasks } from '../../../db/schema.js';
import { resolveModelFor } from '../../../llm/pi.js';
import { loadLlmStore } from '../../../llm/store.js';
import { logger } from '../../../utils/logger.js';
import { insertPreview } from '../store.js';
import { PLAN_MAX, PLAN_TTL_MS, type ToolCtx, type ToolResult } from '../types.js';
import { screenPlan } from './plan.js';

export const MILESTONE_UNCONFIGURED =
  '拆里程碑需要对话模型，还没有配置。请到设置里为「对话」选一个模型。';
const NONE_TEXT = '这次没有拆出里程碑。';
const WHICH_TEXT = '要拆哪个目标？打开那个目标后再说一次。';
const EMPTY_TEXT = '这个目标下还没有可以标成里程碑的待办。';
const ALREADY_TEXT = '这些待办已经是里程碑。';

const SPLIT = /拆成里程碑|分成里程碑|标成里程碑|标为里程碑|设为里程碑/;

type Candidate = { id: string; title: string; outcomeId: string | null; isMilestone: boolean };

let chooser: ((tasks: { id: string; title: string }[]) => string[]) | null = null;

/** Test seam. Production leaves this null and asks the chat model. */
export function setMilestoneSplitChooser(next: ((tasks: { id: string; title: string }[]) => string[]) | null): void {
  chooser = next;
}

export function isMilestoneSplitRequest(text: string): boolean {
  return SPLIT.test(text.replace(/\s+/g, ''));
}

function previewOf(summary: string, previewId: string, expiresAt: string, diffs: ToolResult): ToolResult {
  if (diffs.status !== 'preview') return diffs;
  return {
    status: 'preview',
    summary,
    previewId,
    expiresAt,
    invalidate: [],
    ...(diffs.diffs !== undefined ? { diffs: diffs.diffs } : {}),
  };
}

async function outcomeIdFor(ctx: ToolCtx): Promise<string | null> {
  if (ctx.page.outcomeId) return ctx.page.outcomeId;
  const ids = [...ctx.page.visibleTaskIds];
  if (ctx.page.taskId) ids.push(ctx.page.taskId);
  if (ids.length === 0) return null;
  const rows = await getDb()
    .select({ id: tasks.id, outcomeId: tasks.outcomeId })
    .from(tasks)
    .where(and(eq(tasks.userId, ctx.userId), inArray(tasks.id, ids), isNull(tasks.deletedAt)));
  const outcomeIds = [...new Set(rows.map((row) => row.outcomeId).filter((id): id is string => id !== null))];
  return outcomeIds.length === 1 ? outcomeIds[0] ?? null : null;
}

async function openCandidates(userId: string, outcomeId: string): Promise<Candidate[]> {
  const rows = await getDb()
    .select({
      id: tasks.id,
      title: tasks.title,
      outcomeId: tasks.outcomeId,
      isMilestone: tasks.isMilestone,
      status: tasks.status,
      habitId: tasks.habitId,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.outcomeId, outcomeId), isNull(tasks.deletedAt), isNull(tasks.habitId)));
  return rows
    .filter((row) => row.status === 'todo' || row.status === 'doing')
    .map((row) => ({ id: row.id, title: row.title, outcomeId: row.outcomeId, isMilestone: row.isMilestone }));
}

const submitMilestonesSchema = Type.Object({
  taskIds: Type.Array(Type.String(), { maxItems: PLAN_MAX }),
});
type SubmitMilestonesArgs = Static<typeof submitMilestonesSchema>;

function milestoneTool(capture: (ids: string[]) => void): AgentTool<typeof submitMilestonesSchema> {
  return {
    name: 'submit_milestones',
    label: '提交里程碑',
    description: '提交要标成里程碑的待办 id。只能使用给定列表里的 id。没有合适的就传空数组。',
    parameters: submitMilestonesSchema,
    execute: (_id, params: SubmitMilestonesArgs) => {
      capture(params.taskIds.filter((id) => typeof id === 'string'));
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }], details: null, terminate: true });
    },
  };
}

async function chooseIds(userId: string, candidates: Candidate[]): Promise<string[] | 'unconfigured'> {
  if (chooser) return chooser(candidates.map((task) => ({ id: task.id, title: task.title })));
  const store = await loadLlmStore(userId);
  if (resolveModelFor(store, 'agent.chat') === null) return 'unconfigured';
  const user = await getUserEntity(userId);
  const listed = candidates.map((task) => `- id=${task.id} <data>${task.title}</data>`).join('\n');
  const result = await runProposalPass<{ taskIds: string[] }>({
    user,
    capability: 'agent.chat',
    systemPrompt:
      '你从给定待办里挑选适合作为里程碑的 id。只能使用列表中的 id，不得编造。必须调用 submit_milestones。没有合适的就传空数组。不要把已经完成的事说成还没做。',
    userPrompt: `待办：\n${listed}`,
    makeTool: (capture) => milestoneTool((ids) => capture({ taskIds: ids })),
  });
  return result?.args.taskIds ?? [];
}

export async function answerMilestoneRequest(
  ctx: ToolCtx,
  _text: string,
): Promise<{ text: string; card: ToolResult | null }> {
  const outcomeId = await outcomeIdFor(ctx);
  if (!outcomeId) return { text: WHICH_TEXT, card: null };
  const candidates = await openCandidates(ctx.userId, outcomeId);
  if (candidates.length === 0) return { text: EMPTY_TEXT, card: null };
  const unmarked = candidates.filter((task) => !task.isMilestone);
  if (unmarked.length === 0) return { text: ALREADY_TEXT, card: null };
  let picked: string[];
  try {
    const chosen = await chooseIds(ctx.userId, unmarked);
    if (chosen === 'unconfigured') return { text: MILESTONE_UNCONFIGURED, card: null };
    picked = chosen;
  } catch (err) {
    logger.info('milestone split failed', { reason: err instanceof Error ? err.name : 'error' });
    return { text: NONE_TEXT, card: null };
  }
  const allowed = new Set(unmarked.map((task) => task.id));
  const ids = [...new Set(picked.filter((id) => allowed.has(id)))].slice(0, PLAN_MAX);
  if (ids.length === 0) return { text: NONE_TEXT, card: null };
  const screened = await screenPlan(
    ctx,
    ids.map((taskId) => ({ taskId, isMilestone: true })),
  );
  if (!('stored' in screened)) return { text: screened.status === 'needs_input' ? screened.question : NONE_TEXT, card: null };
  const preview = await insertPreview({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    toolName: 'tasks.propose_plan',
    args: screened.stored,
    summary: screened.summary,
    ttlMs: PLAN_TTL_MS,
  });
  const card = previewOf(screened.summary, preview.id, preview.expiresAt, {
    status: 'preview',
    summary: screened.summary,
    previewId: preview.id,
    expiresAt: preview.expiresAt,
    invalidate: [],
    diffs: screened.diffs,
  });
  return { text: `${screened.summary}。确认后才会把这些待办标成里程碑。`, card };
}
