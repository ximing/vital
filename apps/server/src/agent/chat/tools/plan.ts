import { randomUUID } from 'node:crypto';
import type { ApplyPlanResult, ChatInvalidateTag, ChatPlanDiff, ChatUndoHint } from '@vital/dto';
import { Type } from '@earendil-works/pi-ai';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { recordAgentEdit } from '../../edit-events.service.js';
import { enqueueOutcomeRefresh, enqueueTaskDecompose, enqueueTodayLayout, hasPendingDecomposeAction } from '../../jobs.js';
import { markAgentSchedule } from '../../scheduling.js';
import { getUserEntity } from '../../../auth/auth.service.js';
import { getDb } from '../../../db/index.js';
import {
  agentChatMessages,
  agentChatPreviews,
  outcomes,
  taskCompletions,
  tasks,
  type TaskRow,
} from '../../../db/schema.js';
import { syncTaskNotifications } from '../../../notifications/outbox.js';
import { isDefer, needsDecomposition } from '../../../outcomes/rule-engine.js';
import { formatSlotRange } from '../../schedule-proposal.js';
import { fireIndexTask } from '../../../tasks/tasks.shared.js';
import { register } from '../registry.js';
import { clipPayload, getOwnedPreview, insertPreview, updateOpenPreview } from '../store.js';
import { needsInput, PLAN_MAX, PLAN_TTL_MS, toolError, type ToolCtx, type ToolResult } from '../types.js';

const priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const status = z.enum(['todo', 'doing', 'done', 'canceled']);

const instant = z.string().datetime({ offset: true });

export const planPatchSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(500).optional(),
  dueYmd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** Clock start. Pair with dueAt. Not an all-day dueYmd. */
  startAt: instant.optional(),
  /** Clock end. Pair with startAt. */
  dueAt: instant.optional(),
  priority: priority.optional(),
  status: status.optional(),
  outcomeId: z.string().uuid().nullable().optional(),
  isMilestone: z.boolean().optional(),
});

export const planInputSchema = z.object({
  patches: z.array(planPatchSchema).min(1).max(PLAN_MAX + 1),
});

const storedPatchSchema = planPatchSchema.extend({
  revision: z.string().min(1),
});

const storedPlanSchema = z.object({
  timezone: z.string().min(1),
  patches: z.array(storedPatchSchema).max(PLAN_MAX),
});

export type PlanPatchInput = z.infer<typeof planPatchSchema>;
type StoredPatch = z.infer<typeof storedPatchSchema>;
type PlanStep = Extract<ChatUndoHint, { kind: 'plan' }>['steps'][number];
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

const STATUS_LABEL: Record<z.infer<typeof status>, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  canceled: '已取消',
};

function dueAtFromYmd(ymd: string, zone: string): Date | null {
  const dt = DateTime.fromISO(`${ymd}T00:00:00`, { zone });
  return dt.isValid ? dt.toJSDate() : null;
}

function ymdLabel(date: Date | null, zone: string): string {
  if (!date) return '无日期';
  return DateTime.fromJSDate(date).setZone(zone).toFormat('yyyy-MM-dd');
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

function sameRevision(updatedAt: Date, revision: string): boolean {
  const parsed = Date.parse(revision);
  return Number.isFinite(parsed) && updatedAt.getTime() === parsed;
}

function isRecurring(row: TaskRow): boolean {
  return row.recurrenceRrule !== null || row.recurrenceKind !== null;
}

function clipTitle(value: string): string {
  return value.length > 120 ? value.slice(0, 120) : value;
}

function toInput(patch: StoredPatch): PlanPatchInput {
  return {
    taskId: patch.taskId,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.dueYmd !== undefined ? { dueYmd: patch.dueYmd } : {}),
    ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
    ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.outcomeId !== undefined ? { outcomeId: patch.outcomeId } : {}),
    ...(patch.isMilestone !== undefined ? { isMilestone: patch.isMilestone } : {}),
  };
}

function mergePatches(existing: PlanPatchInput[], patch: PlanPatchInput): PlanPatchInput[] {
  const next = existing.map((item) => ({ ...item }));
  const index = next.findIndex((item) => item.taskId === patch.taskId);
  if (index >= 0) {
    const prior = next[index];
    if (!prior) return next;
    next[index] = { ...prior, ...patch, taskId: prior.taskId };
    return next;
  }
  next.push(patch);
  return next;
}

function previewResult(summary: string, previewId: string, expiresAt: string, diffs: ChatPlanDiff[]): ToolResult {
  return { status: 'preview', summary, previewId, expiresAt, invalidate: [], diffs };
}

export async function screenPlan(
  ctx: ToolCtx,
  patches: PlanPatchInput[],
): Promise<{ stored: { timezone: string; patches: StoredPatch[] }; summary: string; diffs: ChatPlanDiff[] } | ToolResult> {
  if (patches.length === 0) return needsInput('方案里至少要有一条改动。');
  if (patches.length > PLAN_MAX) return needsInput('一份方案最多 20 条。');
  const seen = new Set<string>();
  for (const patch of patches) {
    if (seen.has(patch.taskId)) return needsInput('同一条任务在方案里出现了两次。');
    seen.add(patch.taskId);
  }
  const ids = [...seen];
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, ctx.userId), inArray(tasks.id, ids), isNull(tasks.deletedAt)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const outcomeIds = new Set<string>();
  for (const row of rows) if (row.outcomeId) outcomeIds.add(row.outcomeId);
  for (const patch of patches) if (patch.outcomeId) outcomeIds.add(patch.outcomeId);
  const names = new Map<string, string>();
  if (outcomeIds.size > 0) {
    const found = await getDb()
      .select({ id: outcomes.id, name: outcomes.name })
      .from(outcomes)
      .where(and(eq(outcomes.userId, ctx.userId), inArray(outcomes.id, [...outcomeIds])));
    for (const outcome of found) names.set(outcome.id, outcome.name);
  }
  const stored: StoredPatch[] = [];
  const diffs: ChatPlanDiff[] = [];
  for (const patch of patches) {
    const row = byId.get(patch.taskId);
    if (!row) return needsInput('有一条待办不存在。');
    if (row.habitId) return needsInput(`「${row.title}」是习惯打卡，不能放进方案。`);
    if (patch.outcomeId && !names.has(patch.outcomeId)) return needsInput('归属不存在。');
    if (patch.isMilestone === true && patch.outcomeId === null) {
      return needsInput(`「${row.title}」没有归属目标，不能标成里程碑。`);
    }
    if (patch.isMilestone === true && !row.outcomeId && patch.outcomeId === undefined) {
      return needsInput(`「${row.title}」没有归属目标，不能标成里程碑。`);
    }
    if ((patch.startAt === undefined) !== (patch.dueAt === undefined)) {
      return needsInput('时段要同时给出开始和结束。');
    }
    if (patch.dueYmd !== undefined && patch.startAt !== undefined) {
      return needsInput('时段和全天日期不要一起改。');
    }
    if (row.calendarKey && (patch.startAt !== undefined || patch.dueYmd !== undefined)) {
      return needsInput(`「${row.title}」来自日历，不能改时间。`);
    }
    if (isRecurring(row) && (patch.dueYmd !== undefined || patch.startAt !== undefined || patch.status === 'done')) {
      return needsInput(`「${row.title}」是重复任务，日期和完成不放进方案。`);
    }
    if (patch.status === 'done' && (row.status === 'done' || row.status === 'canceled')) {
      return needsInput(row.status === 'done' ? `「${row.title}」已经完成。` : `「${row.title}」已取消，不能标完成。`);
    }
    if (patch.status && patch.status !== 'done' && row.status === 'done') {
      return needsInput(`「${row.title}」已经完成，方案里不能改回。`);
    }
    const built = buildChange(row, patch, ctx.timezone, names);
    if (!built) return needsInput(`「${row.title}」没有要改的内容。`);
    stored.push(built.stored);
    diffs.push(built.diff);
  }
  return { stored: { timezone: ctx.timezone, patches: stored }, summary: `确认后改 ${String(stored.length)} 条`, diffs };
}

function buildChange(
  row: TaskRow,
  patch: PlanPatchInput,
  zone: string,
  names: Map<string, string>,
): { stored: StoredPatch; diff: ChatPlanDiff } | null {
  const stored: StoredPatch = { taskId: row.id, revision: row.updatedAt.toISOString() };
  const changes: ChatPlanDiff['changes'] = [];
  if (patch.title !== undefined && patch.title !== row.title) {
    stored.title = patch.title;
    changes.push({ label: '标题', before: row.title, after: patch.title });
  }
  if (patch.startAt !== undefined && patch.dueAt !== undefined) {
    const start = new Date(patch.startAt);
    const due = new Date(patch.dueAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(due.getTime()) || due.getTime() <= start.getTime()) return null;
    const changed =
      !sameInstant(start, row.startAt) || !sameInstant(due, row.dueAt) || row.isAllDay || !row.agentScheduled;
    if (changed) {
      stored.startAt = patch.startAt;
      stored.dueAt = patch.dueAt;
      const before = row.isAllDay ? null : row.startAt;
      const beforeEnd = row.isAllDay ? null : row.dueAt;
      changes.push({
        label: '时段',
        before: formatSlotRange(before, beforeEnd, zone),
        after: formatSlotRange(start, due, zone),
      });
    }
  }
  if (patch.dueYmd !== undefined) {
    const next = patch.dueYmd === null ? null : dueAtFromYmd(patch.dueYmd, zone);
    if (next === null && patch.dueYmd !== null) return null;
    if (!sameInstant(next, row.dueAt)) {
      stored.dueYmd = patch.dueYmd;
      changes.push({ label: '日期', before: ymdLabel(row.dueAt, zone), after: patch.dueYmd === null ? '无日期' : patch.dueYmd });
    }
  }
  if (patch.priority !== undefined && patch.priority !== row.priority) {
    stored.priority = patch.priority;
    changes.push({ label: '优先级', before: `P${String(row.priority)}`, after: `P${String(patch.priority)}` });
  }
  if (patch.status !== undefined && patch.status !== row.status) {
    stored.status = patch.status;
    const before = STATUS_LABEL[row.status as keyof typeof STATUS_LABEL] ?? row.status;
    changes.push({ label: '状态', before, after: STATUS_LABEL[patch.status] });
  }
  if (patch.outcomeId !== undefined && patch.outcomeId !== row.outcomeId) {
    stored.outcomeId = patch.outcomeId;
    const before = row.outcomeId ? (names.get(row.outcomeId) ?? '无') : '无';
    const after = patch.outcomeId ? (names.get(patch.outcomeId) ?? '无') : '无';
    changes.push({ label: '归属', before, after });
  }
  if (patch.isMilestone !== undefined && patch.isMilestone !== row.isMilestone) {
    stored.isMilestone = patch.isMilestone;
    changes.push({ label: '里程碑', before: row.isMilestone ? '是' : '否', after: patch.isMilestone ? '是' : '否' });
  }
  if (changes.length === 0) return null;
  return { stored, diff: { taskId: row.id, title: row.title, changes } };
}

export async function appendToOpenPlan(ctx: ToolCtx, patch: PlanPatchInput): Promise<ToolResult> {
  const previewId = ctx.gate.plan?.previewId;
  if (!previewId) return toolError('EXECUTION_FAILED', '没有打开的方案。');
  const row = await getOwnedPreview(ctx.userId, previewId);
  const open = row && row.status === 'open' && row.expiresAt > new Date() ? storedPlanSchema.safeParse(row.args) : null;
  const existing = open?.success ? open.data.patches.map(toInput) : [];
  const screened = await screenPlan(ctx, mergePatches(existing, patch));
  if (!('stored' in screened)) return screened;
  if (open?.success && row) {
    const updated = await updateOpenPreview(ctx.userId, row.id, screened.stored, screened.summary);
    if (updated) return previewResult(screened.summary, row.id, row.expiresAt.toISOString(), screened.diffs);
  }
  const created = await insertPreview({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    toolName: 'tasks.propose_plan',
    args: screened.stored,
    summary: screened.summary,
    ttlMs: PLAN_TTL_MS,
  });
  return previewResult(screened.summary, created.id, created.expiresAt, screened.diffs);
}

interface AppliedItem {
  taskId: string;
  title: string;
  summary: string;
  steps: PlanStep[];
}

export async function applyAgentPlan(userId: string, planId: string, now = new Date()): Promise<ApplyPlanResult | null> {
  const user = await getUserEntity(userId);
  const outcome = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(agentChatPreviews)
      .where(and(eq(agentChatPreviews.id, planId), eq(agentChatPreviews.userId, userId)))
      .for('update');
    if (!row || row.toolName !== 'tasks.propose_plan' || row.status !== 'open') return null;
    if (row.expiresAt <= now) {
      await tx.update(agentChatPreviews).set({ status: 'expired' }).where(eq(agentChatPreviews.id, row.id));
      return null;
    }
    const parsed = storedPlanSchema.safeParse(row.args);
    if (!parsed.success) {
      await tx.update(agentChatPreviews).set({ status: 'cancelled' }).where(eq(agentChatPreviews.id, row.id));
      return null;
    }
    const applied: AppliedItem[] = [];
    const skipped: { taskId: string; reason: string }[] = [];
    let marked = false;
    for (const patch of parsed.data.patches) {
      const one = await applyOne(tx, user, userId, parsed.data.timezone, patch, now);
      if ('reason' in one) {
        skipped.push({ taskId: patch.taskId, reason: one.reason });
        continue;
      }
      if (!marked) {
        await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
        marked = true;
      }
      applied.push(one);
    }
    await tx.update(agentChatPreviews).set({ status: 'applied' }).where(eq(agentChatPreviews.id, row.id));
    const steps = applied.flatMap((item) => item.steps);
    const lines = [
      ...applied.map((item) => item.summary),
      ...skipped.map((item) => `已跳过：${item.reason}`),
    ];
    const summary = lines.join('\n') || '没有改动';
    let undoHintId: string | null = null;
    if (steps.length > 0) {
      undoHintId = randomUUID();
      await tx.insert(agentChatMessages).values({
        id: undoHintId,
        userId,
        conversationId: row.conversationId,
        role: 'tool',
        text: '方案已应用',
        toolName: 'tasks.propose_plan',
        toolPayload: clipPayload({
          status: 'ok',
          summary: '方案已应用',
          undo: { kind: 'plan', steps },
          invalidate: ['tasks', 'today', 'outcomes'],
        }),
        createdAt: now,
      });
    }
    await tx.insert(agentChatMessages).values({
      id: randomUUID(),
      userId,
      conversationId: row.conversationId,
      role: 'assistant',
      text: summary,
      createdAt: new Date(now.getTime() + 1),
    });
    await sealCards(tx, userId, row.conversationId, row.id);
    const appliedIds = applied.map((item) => item.taskId);
    const indexed = appliedIds.length === 0 ? [] : await tx.select().from(tasks).where(inArray(tasks.id, appliedIds));
    const invalidate: ChatInvalidateTag[] = applied.length > 0 ? ['tasks', 'today', 'outcomes'] : [];
    return {
      public: { summary, invalidate, applied: applied.length, skipped, undoHintId },
      indexed,
    };
  });
  if (!outcome) return null;
  for (const row of outcome.indexed) fireIndexTask(row);
  return outcome.public;
}

async function sealCards(tx: Tx, userId: string, conversationId: string, previewId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(agentChatMessages)
    .where(
      and(
        eq(agentChatMessages.userId, userId),
        eq(agentChatMessages.conversationId, conversationId),
        inArray(agentChatMessages.toolName, ['tasks.propose_plan', 'tasks.propose_schedule']),
      ),
    );
  for (const row of rows) {
    const payload = row.toolPayload;
    if (!payload || typeof payload !== 'object' || !('previewId' in payload)) continue;
    if ((payload as { previewId?: unknown }).previewId !== previewId) continue;
    const body = payload as { summary?: unknown; diffs?: unknown };
    await tx
      .update(agentChatMessages)
      .set({
        toolPayload: {
          status: 'ok',
          summary: typeof body.summary === 'string' ? body.summary : row.text,
          ...(body.diffs !== undefined ? { diffs: body.diffs } : {}),
        },
      })
      .where(eq(agentChatMessages.id, row.id));
  }
}

async function applyOne(
  tx: Tx,
  user: Awaited<ReturnType<typeof getUserEntity>>,
  userId: string,
  zone: string,
  patch: StoredPatch,
  now: Date,
): Promise<AppliedItem | { reason: string }> {
  const [row] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, patch.taskId), eq(tasks.userId, userId)))
    .for('update');
  if (!row || row.deletedAt) return { reason: '这条已经不在了' };
  if (row.habitId) return { reason: `「${row.title}」是习惯打卡` };
  if (!sameRevision(row.updatedAt, patch.revision)) return { reason: `「${row.title}」这条在方案之后被改过` };
  if (row.calendarKey && (patch.startAt !== undefined || patch.dueYmd !== undefined)) {
    return { reason: `「${row.title}」来自日历，不改时间` };
  }
  if (isRecurring(row) && (patch.dueYmd !== undefined || patch.startAt !== undefined || patch.status === 'done')) {
    return { reason: `「${row.title}」是重复任务，日期和完成不放进方案` };
  }
  if (patch.outcomeId) {
    const [outcome] = await tx
      .select({ id: outcomes.id })
      .from(outcomes)
      .where(and(eq(outcomes.id, patch.outcomeId), eq(outcomes.userId, userId)))
      .limit(1);
    if (!outcome) return { reason: `「${row.title}」的归属已经不存在` };
  }
  const nextOutcomeId = patch.outcomeId !== undefined ? patch.outcomeId : row.outcomeId;
  if (patch.isMilestone === true && !nextOutcomeId) {
    return { reason: `「${row.title}」没有归属目标，不能标成里程碑` };
  }
  if (patch.status === 'done' && (row.status === 'done' || row.status === 'canceled')) {
    return { reason: row.status === 'done' ? `「${row.title}」已经完成` : `「${row.title}」已取消，不能标完成` };
  }
  if (patch.status && patch.status !== 'done' && row.status === 'done') {
    return { reason: `「${row.title}」已经完成，方案里不能改回` };
  }

  const column: Partial<TaskRow> = { updatedAt: now };
  const previous: Record<string, unknown> = {};
  const fields: { field: string; before: unknown; after: unknown }[] = [];
  let nextDue = row.dueAt;
  if (patch.title !== undefined && patch.title !== row.title) {
    column.title = patch.title;
    previous.title = row.title;
    fields.push({ field: 'title', before: clipTitle(row.title), after: clipTitle(patch.title) });
  }
  if (patch.priority !== undefined && patch.priority !== row.priority) {
    column.priority = patch.priority;
    previous.priority = row.priority;
    fields.push({ field: 'priority', before: row.priority, after: patch.priority });
  }
  if (patch.outcomeId !== undefined && patch.outcomeId !== row.outcomeId) {
    column.outcomeId = patch.outcomeId;
    previous.outcomeId = row.outcomeId;
    fields.push({ field: 'outcomeId', before: row.outcomeId, after: patch.outcomeId });
  }
  if (patch.isMilestone !== undefined && patch.isMilestone !== row.isMilestone) {
    column.isMilestone = patch.isMilestone;
    previous.isMilestone = row.isMilestone;
    fields.push({ field: 'isMilestone', before: row.isMilestone, after: patch.isMilestone });
  }
  if (patch.startAt !== undefined && patch.dueAt !== undefined) {
    const start = new Date(patch.startAt);
    const due = new Date(patch.dueAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(due.getTime()) || due.getTime() <= start.getTime()) {
      return { reason: `「${row.title}」的时段无效` };
    }
    const unchanged =
      sameInstant(start, row.startAt) && sameInstant(due, row.dueAt) && !row.isAllDay && row.agentScheduled;
    if (!unchanged) {
      column.startAt = start;
      column.dueAt = due;
      column.isAllDay = false;
      column.timezone = zone;
      column.agentScheduled = true;
      nextDue = due;
      previous.startAt = row.startAt ? row.startAt.toISOString() : null;
      previous.dueAt = row.dueAt ? row.dueAt.toISOString() : null;
      previous.isAllDay = row.isAllDay;
      previous.timezone = row.timezone;
      previous.agentScheduled = row.agentScheduled;
      fields.push({
        field: 'startAt',
        before: row.startAt ? row.startAt.toISOString() : null,
        after: start.toISOString(),
      });
      fields.push({
        field: 'dueAt',
        before: row.dueAt ? row.dueAt.toISOString() : null,
        after: due.toISOString(),
      });
      if (isDefer(row.dueAt, due, now)) column.deferCount = row.deferCount + 1;
    }
  }
  if (patch.dueYmd !== undefined) {
    const due = patch.dueYmd === null ? null : dueAtFromYmd(patch.dueYmd, zone);
    if (due === null && patch.dueYmd !== null) return { reason: `「${row.title}」的日期无效` };
    if (!sameInstant(due, row.dueAt)) {
      column.dueAt = due;
      column.timezone = zone;
      column.isAllDay = patch.dueYmd === null ? row.isAllDay : true;
      nextDue = due;
      previous.dueAt = row.dueAt ? row.dueAt.toISOString() : null;
      previous.isAllDay = row.isAllDay;
      previous.timezone = row.timezone;
      fields.push({
        field: 'dueAt',
        before: row.dueAt ? row.dueAt.toISOString() : null,
        after: due ? due.toISOString() : null,
      });
      if (due === null && (row.reminderMode === 'due' || row.reminderMode === 'offset')) {
        column.reminderMode = 'none';
        column.reminderOffsetMinutes = null;
        column.reminderAt = null;
        previous.reminderMode = row.reminderMode;
        previous.reminderOffsetMinutes = row.reminderOffsetMinutes;
        previous.reminderAt = row.reminderAt ? row.reminderAt.toISOString() : null;
      }
      if (isDefer(row.dueAt, due, now)) column.deferCount = row.deferCount + 1;
      if (row.agentScheduled) {
        column.agentScheduled = false;
        previous.agentScheduled = true;
      }
    }
  }
  const wantComplete = patch.status === 'done' && row.status !== 'done';
  if (patch.status && patch.status !== 'done' && patch.status !== row.status) {
    column.status = patch.status;
    previous.status = row.status;
    fields.push({ field: 'status', before: row.status, after: patch.status });
  }
  if (wantComplete) {
    fields.push({ field: 'status', before: row.status, after: 'done' });
    if (row.status !== 'todo') previous.status = row.status;
  }
  if (Object.keys(previous).length === 0 && !wantComplete) return { reason: `「${row.title}」没有变化` };

  await tx.update(tasks).set(column).where(eq(tasks.id, row.id));
  let current: TaskRow = { ...row, ...column, dueAt: nextDue };
  let completionId: string | null = null;
  if (wantComplete) {
    completionId = randomUUID();
    const occurrenceAt = current.dueAt ?? now;
    await tx.insert(taskCompletions).values({
      id: completionId,
      taskId: row.id,
      occurrenceAt,
      completedAt: now,
      dueWasNull: current.dueAt === null,
    });
    await tx
      .update(tasks)
      .set({ status: 'done', completedAt: now, updatedAt: now })
      .where(eq(tasks.id, row.id));
    current = { ...current, status: 'done', completedAt: now, updatedAt: now };
  }
  await recordAgentEdit(tx, userId, row.id, fields);
  await syncTaskNotifications(
    {
      id: current.id,
      userId: current.userId,
      listId: current.listId,
      title: current.title,
      status: current.status,
      dueAt: current.dueAt,
      reminderMode: current.reminderMode,
      reminderOffsetMinutes: current.reminderOffsetMinutes,
      reminderAt: current.reminderAt,
      isAllDay: current.isAllDay,
      timezone: current.timezone,
      deletedAt: current.deletedAt,
      habitId: current.habitId,
      habitSeq: current.habitSeq,
      habitKey: current.habitKey,
      createdAt: current.createdAt,
    },
    user,
    now,
    tx,
  );
  const outcomeIds = new Set<string>();
  if (row.outcomeId) outcomeIds.add(row.outcomeId);
  if (current.outcomeId) outcomeIds.add(current.outcomeId);
  for (const outcomeId of outcomeIds) await enqueueOutcomeRefresh(tx, userId, outcomeId, now);
  if (
    column.deferCount !== undefined &&
    needsDecomposition(column.deferCount) &&
    !(await hasPendingDecomposeAction(tx, row.id, userId))
  ) {
    await enqueueTaskDecompose(tx, userId, row.id, now);
  }
  if (wantComplete) await enqueueTodayLayout(tx, userId, now, 'complete');

  const steps: PlanStep[] = [];
  if (completionId) steps.push({ kind: 'uncomplete', taskId: row.id, completionId });
  if (Object.keys(previous).length > 0) steps.push({ kind: 'patch_task', taskId: row.id, previous });
  const summary = wantComplete ? `已完成「${current.title}」` : `已更新「${current.title}」`;
  return { taskId: row.id, title: current.title, summary, steps };
}

register({
  name: 'tasks.propose_plan',
  label: '提交变更方案',
  description:
    '提交一份待办变更方案，最多 20 条，不会立刻改数据。每条用 taskId，可改 title、dueYmd（YYYY-MM-DD 或 null）、startAt 与 dueAt（成对的带时区时刻，表示时段）、priority、status（todo/doing/done/canceled）、outcomeId（或 null）、isMilestone（是否为所属目标的里程碑，任务必须已有归属）。不要删除任务，不要改日历镜像的时间，不要包含习惯打卡或重复任务的日期和完成。把待办塞进某一天请改用 tasks.propose_schedule。确认前不改任务。',
  parameters: Type.Object({
    patches: Type.Array(
      Type.Object({
        taskId: Type.String(),
        title: Type.Optional(Type.String()),
        dueYmd: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        startAt: Type.Optional(Type.String()),
        dueAt: Type.Optional(Type.String()),
        priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
        status: Type.Optional(Type.String()),
        outcomeId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        isMilestone: Type.Optional(Type.Boolean()),
      }),
      { minItems: 1, maxItems: PLAN_MAX },
    ),
  }),
  input: planInputSchema,
  mode: 'mutate',
  handler: async (ctx, input): Promise<ToolResult> => {
    const screened = await screenPlan(ctx, input.patches);
    if (!('stored' in screened)) return screened;
    const openId = ctx.gate.plan?.previewId;
    if (openId) {
      const updated = await updateOpenPreview(ctx.userId, openId, screened.stored, screened.summary);
      if (updated) {
        const row = await getOwnedPreview(ctx.userId, openId);
        const expiresAt = row?.expiresAt.toISOString() ?? new Date(Date.now() + PLAN_TTL_MS).toISOString();
        return previewResult(screened.summary, openId, expiresAt, screened.diffs);
      }
    }
    const preview = await insertPreview({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      toolName: 'tasks.propose_plan',
      args: screened.stored,
      summary: screened.summary,
      ttlMs: PLAN_TTL_MS,
    });
    return previewResult(screened.summary, preview.id, preview.expiresAt, screened.diffs);
  },
});
