import type { ChatPlanDiff } from '@vital/dto';
import { Type } from '@earendil-works/pi-ai';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { spokenDueYmd } from '../../../llm/spoken-date.js';
import { getDb } from '../../../db/index.js';
import { tasks, users, type TaskRow } from '../../../db/schema.js';
import {
  SCHEDULE_OFF_TEXT,
  busyBlock,
  clipWorkWindow,
  formatSlotRange,
  hhmmToMinutes,
  isScheduleRequest,
  minutesOnDay,
  proposeSchedule,
  schedulePart,
  slotMinutes,
  type ScheduleCandidate,
  type ScheduleWindow,
} from '../../schedule-proposal.js';
import { loadRhythmProfileSafe } from '../../rhythm-distill.js';
import { preferredWindows } from '../../rhythm-profile.js';
import { register } from '../registry.js';
import { insertPreview } from '../store.js';
import { PLAN_MAX, PLAN_TTL_MS, needsInput, type ToolCtx, type ToolResult } from '../types.js';
import { screenPlan } from './plan.js';

const NONE_TEXT = '没有可以排的待办。打开待办列表，让要排的几件出现在眼前后再说一次。';
const DAY_TEXT = '没有看懂要排哪一天。';

const scheduleInputSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  taskIds: z.array(z.string().uuid()).max(PLAN_MAX).optional(),
  part: z.enum(['morning', 'afternoon', 'day']).optional(),
});

function previewOf(summary: string, previewId: string, expiresAt: string, diffs: ChatPlanDiff[]): ToolResult {
  return { status: 'preview', summary, previewId, expiresAt, invalidate: [], diffs };
}

function replyText(source: string, day: string, zone: string, summary: string, unplaced: number): string {
  const named = /(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/.exec(source);
  const head = named ? `${named[0].replace(/\s+/g, '')}是 ${day}（${zone}）。` : `排到 ${day}（${zone}）。`;
  const tail = unplaced > 0 ? '放不下的留在方案里。' : '';
  return `${head}${summary}。${tail}确认后才会改任务时间，不会写入系统日历。`;
}

function eligible(row: TaskRow): boolean {
  if (row.calendarKey || row.habitId) return false;
  if (row.recurrenceRrule !== null || row.recurrenceKind !== null) return false;
  if (row.status !== 'todo' && row.status !== 'doing') return false;
  return true;
}

function wantedIds(ctx: ToolCtx, explicit: string[] | undefined): string[] | null {
  if (explicit && explicit.length > 0) return explicit;
  if (ctx.page.visibleTaskIds.length > 0) return ctx.page.visibleTaskIds;
  if (ctx.page.taskId) return [ctx.page.taskId];
  return null;
}

async function loadRows(userId: string): Promise<TaskRow[]> {
  return getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt)));
}

export async function buildSchedulePlan(
  ctx: ToolCtx,
  input: { day: string; taskIds?: string[]; part?: 'morning' | 'afternoon' | 'day' },
): Promise<ToolResult> {
  const [user] = await getDb().select().from(users).where(eq(users.id, ctx.userId)).limit(1);
  if (!user) return needsInput('找不到当前用户。');
  if (!user.scheduleSuggest) return needsInput(SCHEDULE_OFF_TEXT);
  const ids = wantedIds(ctx, input.taskIds);
  if (!ids) return needsInput(NONE_TEXT);
  const wanted = new Set(ids);
  const rows = await loadRows(ctx.userId);
  const candidates = rows
    .filter((row) => wanted.has(row.id) && eligible(row))
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'zh') || a.id.localeCompare(b.id))
    .slice(0, PLAN_MAX);
  if (candidates.length === 0) return needsInput(NONE_TEXT);
  const startMin = hhmmToMinutes(user.workHoursStart) ?? 9 * 60;
  const endMin = hhmmToMinutes(user.workHoursEnd) ?? 18 * 60;
  const window = clipWorkWindow(startMin, endMin, input.part ?? 'day');
  const chosen = new Set(candidates.map((row) => row.id));
  const busy: ScheduleWindow[] = [];
  for (const row of rows) {
    if (chosen.has(row.id) || row.habitId || row.status === 'canceled') continue;
    const block = busyBlock(row, ctx.timezone, input.day);
    if (block) busy.push(block);
  }
  const specs: ScheduleCandidate[] = candidates.map((row) => ({
    id: row.id,
    title: row.title,
    minutes: slotMinutes(row.estimateMinutes),
    priority: row.priority,
  }));
  const preferred = preferredWindows(await loadRhythmProfileSafe(ctx.userId));
  const proposal = proposeSchedule({
    window: window ?? { startMin: 0, endMin: 0 },
    dayCapMinutes: user.scheduleDayCapMinutes,
    busy,
    candidates: specs,
    ...(preferred.length > 0 ? { preferred } : {}),
  });
  const byId = new Map(candidates.map((row) => [row.id, row]));
  const patches = proposal.placed.flatMap((slot) => {
    const start = minutesOnDay(input.day, slot.startMin, ctx.timezone);
    const due = minutesOnDay(input.day, slot.endMin, ctx.timezone);
    if (!start || !due) return [];
    return [{ taskId: slot.id, startAt: start.toISOString(), dueAt: due.toISOString() }];
  });
  const unplaced: ChatPlanDiff[] = proposal.unplaced.flatMap((item) => {
    const row = byId.get(item.id);
    if (!row) return [];
    const before = row.isAllDay ? '未排' : formatSlotRange(row.startAt, row.dueAt, ctx.timezone);
    return [{ taskId: row.id, title: row.title, changes: [{ label: '时段', before, after: '放不下' }] }];
  });
  if (patches.length === 0) {
    const summary = '这几件放不下';
    const preview = await insertPreview({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: 'tasks.propose_plan',
      args: { timezone: ctx.timezone, patches: [] },
      summary,
      ttlMs: PLAN_TTL_MS,
    });
    return previewOf(summary, preview.id, preview.expiresAt, unplaced);
  }
  const screened = await screenPlan(ctx, patches);
  if (!('stored' in screened)) return screened;
  const summary = unplaced.length > 0 ? `${screened.summary}，其余放不下` : screened.summary;
  const preview = await insertPreview({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    toolName: 'tasks.propose_plan',
    args: screened.stored,
    summary,
    ttlMs: PLAN_TTL_MS,
  });
  return previewOf(summary, preview.id, preview.expiresAt, [...screened.diffs, ...unplaced]);
}

export async function answerScheduleRequest(
  ctx: ToolCtx,
  text: string,
  now = new Date(),
): Promise<{ text: string; card: ToolResult | null }> {
  const day = spokenDueYmd(text, ctx.timezone, now);
  if (!day) return { text: DAY_TEXT, card: null };
  const card = await buildSchedulePlan(ctx, { day, part: schedulePart(text) });
  if (card.status === 'needs_input') return { text: card.question, card: null };
  if (card.status !== 'preview') return { text: '这次没有排出方案。', card: null };
  const unplaced = card.diffs?.filter((diff) => diff.changes.some((change) => change.after === '放不下')).length ?? 0;
  return { text: replyText(text, day, ctx.timezone, card.summary, unplaced), card };
}

export { isScheduleRequest };

register({
  name: 'tasks.propose_schedule',
  label: '提议一天的时段',
  description:
    '把已有待办排进某一天的空档，只产出方案卡，确认前不改任务，也不写系统日历。day 是 YYYY-MM-DD；不传则用眼前列表。part 可以是 morning、afternoon 或 day。没有估时按 30 分钟。放不下的条目留在方案里。开关关闭时不要编造时段。',
  parameters: Type.Object({
    day: Type.Optional(Type.String()),
    taskIds: Type.Optional(Type.Array(Type.String(), { maxItems: PLAN_MAX })),
    part: Type.Optional(Type.String()),
  }),
  input: scheduleInputSchema,
  mode: 'mutate',
  handler: async (ctx, input): Promise<ToolResult> => {
    if (!input.day) return needsInput(DAY_TEXT);
    return buildSchedulePlan(ctx, {
      day: input.day,
      ...(input.taskIds ? { taskIds: input.taskIds } : {}),
      ...(input.part ? { part: input.part } : {}),
    });
  },
});
