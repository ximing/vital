import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type {
  CreateOutcomeInput,
  ListOutcomesQuery,
  Outcome,
  OutcomeDetail,
  OutcomeMaterial,
  OutcomeSignal,
  PatchOutcomeInput,
  TodayDashboard,
  TodayPulse,
} from '@vital/dto';
import { recordOutcomeRename } from '../agent/edit-events.service.js';
import { getDb } from '../db/index.js';
import {
  agentActions,
  habits,
  inboxItems,
  outcomes,
  reports,
  taskCompletions,
  tasks,
  taskTags,
  type OutcomeRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getUserEntity } from '../auth/auth.service.js';
import { summarizePayload, targetNamesFor, toAgentActionDto } from '../agent/actions.service.js';
import { trackIndexJob } from '../retrieval/pipeline.js';
import { indexOutcome, removeOutcomeIndex } from '../retrieval/search.js';
import { listHabitsForOutcome } from '../habits/habits.service.js';
import {
  linkedHabitFacts,
  loadHabitHeadlineFacts,
  type HabitHeadlineFact,
} from '../habits/progress.js';
import { listTasks } from '../tasks/tasks.service.js';
import { toTaskDto } from '../tasks/task-dto.js';
import { computeNow } from './now-engine.js';
import {
  computeSignal,
  isOverdue,
  selectRuleNextStep,
  type NextStepTask,
  type OutcomeFacts,
} from './rule-engine.js';
import { getOwnedOutcomeOr404 } from './shared.js';

export { assertOwnedOutcomeId, getOwnedOutcomeOr404 } from './shared.js';

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function asSignal(value: string | null): OutcomeSignal | null {
  return value === 'up' || value === 'flat' || value === 'alert' ? value : null;
}

interface OutcomeStats {
  openTaskCount: number;
  completedLast7d: number;
  materialCount: number;
}

export function toOutcomeDto(
  row: OutcomeRow,
  stats: OutcomeStats = { openTaskCount: 0, completedLast7d: 0, materialCount: 0 },
): Outcome {
  return {
    id: row.id,
    name: row.name,
    status: row.status === 'closed' ? 'closed' : 'open',
    createdBy: row.createdBy === 'agent' ? 'agent' : 'user',
    ruleSignal: asSignal(row.ruleSignal),
    ruleNextStep: row.ruleNextStep,
    agentHeadline: row.agentHeadline,
    agentSuggestion: row.agentSuggestion,
    agentState:
      row.agentState === 'pending' || row.agentState === 'failed' ? row.agentState : 'idle',
    agentUpdatedAt: iso(row.agentUpdatedAt),
    undoUntil: iso(row.undoUntil),
    lastActivityAt: iso(row.lastActivityAt),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    openTaskCount: stats.openTaskCount,
    completedLast7d: stats.completedLast7d,
    materialCount: stats.materialCount,
  };
}

async function loadMaterialCounts(
  userId: string,
  outcomeIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const id of outcomeIds) map.set(id, 0);
  if (outcomeIds.length === 0) return map;
  const materialRows = await getDb()
    .select({ outcomeId: inboxItems.outcomeId, n: sql<number>`count(*)::int` })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        inArray(inboxItems.outcomeId, outcomeIds),
        isNull(inboxItems.deletedAt),
        ne(inboxItems.status, 'converted'),
      ),
    )
    .groupBy(inboxItems.outcomeId);
  for (const row of materialRows) {
    if (row.outcomeId) map.set(row.outcomeId, row.n);
  }
  return map;
}

/** Per-outcome task/material counters for the board. */
async function statsForOutcomes(
  userId: string,
  outcomeIds: string[],
): Promise<Map<string, OutcomeStats>> {
  const map = new Map<string, OutcomeStats>();
  for (const id of outcomeIds) {
    map.set(id, { openTaskCount: 0, completedLast7d: 0, materialCount: 0 });
  }
  if (outcomeIds.length === 0) return map;

  const openRows = await getDb()
    .select({ outcomeId: tasks.outcomeId, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.outcomeId, outcomeIds),
        inArray(tasks.status, ['todo', 'doing']),
        isNull(tasks.habitId),
        isNull(tasks.deletedAt),
      ),
    )
    .groupBy(tasks.outcomeId);
  for (const row of openRows) {
    if (row.outcomeId) {
      const rec = map.get(row.outcomeId);
      if (rec) rec.openTaskCount = row.n;
    }
  }

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const doneRows = await getDb()
    .select({ outcomeId: tasks.outcomeId, n: sql<number>`count(*)::int` })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.outcomeId, outcomeIds),
        gte(taskCompletions.completedAt, since),
      ),
    )
    .groupBy(tasks.outcomeId);
  for (const row of doneRows) {
    if (row.outcomeId) {
      const rec = map.get(row.outcomeId);
      if (rec) rec.completedLast7d = row.n;
    }
  }

  const timezone = (await getUserEntity(userId)).timezone;
  const habitFacts = await loadHabitHeadlineFacts(userId, timezone);
  for (const fact of habitFacts) {
    if (!fact.outcomeId || !fact.active) continue;
    const rec = map.get(fact.outcomeId);
    if (rec) rec.completedLast7d += fact.daysDoneLast7d;
  }

  const materialCounts = await loadMaterialCounts(userId, outcomeIds);
  for (const [id, n] of materialCounts) {
    const rec = map.get(id);
    if (rec) rec.materialCount = n;
  }

  return map;
}

export async function listOutcomes(userId: string, query: ListOutcomesQuery): Promise<Outcome[]> {
  const filters: SQL[] = [eq(outcomes.userId, userId)];
  if (query.status !== undefined) filters.push(eq(outcomes.status, query.status));
  const rows = await getDb()
    .select()
    .from(outcomes)
    .where(and(...filters))
    .orderBy(asc(outcomes.sortOrder), asc(outcomes.createdAt));
  const stats = await statsForOutcomes(
    userId,
    rows.map((r) => r.id),
  );
  return rows.map((row) => toOutcomeDto(row, stats.get(row.id)));
}

export async function createOutcome(userId: string, input: CreateOutcomeInput): Promise<Outcome> {
  const [maxRow] = await getDb()
    .select({ max: sql<number>`coalesce(max(${outcomes.sortOrder}), -1)` })
    .from(outcomes)
    .where(eq(outcomes.userId, userId));
  const [row] = await getDb()
    .insert(outcomes)
    .values({
      id: randomUUID(),
      userId,
      name: input.name,
      sortOrder: (maxRow?.max ?? -1) + 1,
    })
    .returning();
  if (!row) throw AppError.of(404, 'NOT_FOUND');
  trackIndexJob(indexOutcome(row), 'indexOutcome');
  return toOutcomeDto(row);
}

export async function patchOutcome(
  userId: string,
  id: string,
  input: PatchOutcomeInput,
): Promise<Outcome> {
  const row = await getOwnedOutcomeOr404(userId, id);
  const renamed = input.name !== undefined && input.name !== row.name;
  const [next] = await getDb()
    .update(outcomes)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(eq(outcomes.id, id))
    .returning();
  const stats = await statsForOutcomes(userId, [id]);
  if (!next) throw AppError.of(404, 'NOT_FOUND');
  if (renamed) {
    // A rename is a correction signal: pending agent proposals on this thread were off.
    await getDb()
      .update(agentActions)
      .set({ feedback: 'edited', feedbackAt: new Date() })
      .where(
        and(
          eq(agentActions.userId, userId),
          eq(agentActions.targetType, 'outcome'),
          eq(agentActions.targetId, id),
          eq(agentActions.feedback, 'pending'),
        ),
      );
    // ...and it feeds memory.distill through the edit event stream.
    await recordOutcomeRename(getDb(), userId, id, row.name, next.name);
  }
  trackIndexJob(indexOutcome(next), 'indexOutcome');
  return toOutcomeDto(next, stats.get(id));
}

export async function closeOutcome(userId: string, id: string): Promise<Outcome> {
  await getOwnedOutcomeOr404(userId, id);
  // Tasks keep their outcomeId — closing only hides the thread from the board.
  const [row] = await getDb()
    .update(outcomes)
    .set({ status: 'closed', updatedAt: new Date() })
    .where(and(eq(outcomes.id, id), eq(outcomes.status, 'open')))
    .returning();
  const final = row ?? (await getOwnedOutcomeOr404(userId, id));
  trackIndexJob(indexOutcome(final), 'indexOutcome');
  return toOutcomeDto(final);
}

export async function reopenOutcome(userId: string, id: string): Promise<Outcome> {
  await getOwnedOutcomeOr404(userId, id);
  const [row] = await getDb()
    .update(outcomes)
    .set({ status: 'open', updatedAt: new Date() })
    .where(and(eq(outcomes.id, id), eq(outcomes.status, 'closed')))
    .returning();
  const final = row ?? (await getOwnedOutcomeOr404(userId, id));
  trackIndexJob(indexOutcome(final), 'indexOutcome');
  return toOutcomeDto(final);
}

/** Hard-delete an agent-created thread within its undo window. */
export async function undoOutcome(userId: string, id: string): Promise<void> {
  const row = await getOwnedOutcomeOr404(userId, id);
  if (row.createdBy !== 'agent' || !row.undoUntil || row.undoUntil.getTime() <= Date.now()) {
    throw AppError.of(409, 'VALIDATION_ERROR');
  }
  await getDb().transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ outcomeId: null })
      .where(and(eq(tasks.userId, userId), eq(tasks.outcomeId, id)));
    await tx
      .update(inboxItems)
      .set({ outcomeId: null })
      .where(and(eq(inboxItems.userId, userId), eq(inboxItems.outcomeId, id)));
    await tx
      .update(habits)
      .set({ outcomeId: null, updatedAt: new Date() })
      .where(and(eq(habits.userId, userId), eq(habits.outcomeId, id)));
    await tx
      .update(agentActions)
      .set({ feedback: 'dismissed', feedbackAt: new Date() })
      .where(
        and(
          eq(agentActions.userId, userId),
          eq(agentActions.targetType, 'outcome'),
          eq(agentActions.targetId, id),
          eq(agentActions.feedback, 'pending'),
        ),
      );
    await tx.delete(outcomes).where(eq(outcomes.id, id));
  });
  trackIndexJob(removeOutcomeIndex(id), 'removeOutcomeIndex');
}

/** Hard cap for the detail timeline — mirrors the actions listing. */
const DETAIL_ACTIONS_LIMIT = 50;

/**
 * Aggregated drill-down for one thread: outcome (with fresh rule fields), its
 * non-deleted tasks, attached inbox materials, and the agent ledger rows that
 * touch the thread itself or any of its tasks (newest first).
 */
export async function getOutcomeDetail(userId: string, id: string): Promise<OutcomeDetail> {
  await getOwnedOutcomeOr404(userId, id);
  // Read-through: rule layer is always fresh, same contract as the dashboard.
  await refreshOutcomeRuleFields(userId, id);
  const row = await getOwnedOutcomeOr404(userId, id);
  const stats = await statsForOutcomes(userId, [id]);
  const timezone = (await getUserEntity(userId)).timezone;
  const linkedHabits = await listHabitsForOutcome(userId, id, timezone);

  const taskRows = await getDb()
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.outcomeId, id),
        isNull(tasks.habitId),
        isNull(tasks.deletedAt),
      ),
    )
    .orderBy(asc(tasks.sortOrder), asc(tasks.id));
  const tagRows =
    taskRows.length === 0
      ? []
      : await getDb()
          .select()
          .from(taskTags)
          .where(
            inArray(
              taskTags.taskId,
              taskRows.map((r) => r.id),
            ),
          );
  const tagsByTask = new Map<string, string[]>();
  for (const tagRow of tagRows) {
    const current = tagsByTask.get(tagRow.taskId);
    if (current) current.push(tagRow.tagId);
    else tagsByTask.set(tagRow.taskId, [tagRow.tagId]);
  }

  const materialRows = await getDb()
    .select({
      id: inboxItems.id,
      title: inboxItems.title,
      excerpt: inboxItems.excerpt,
      siteName: inboxItems.siteName,
      source: inboxItems.source,
      status: inboxItems.status,
      capturedAt: inboxItems.capturedAt,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        eq(inboxItems.outcomeId, id),
        isNull(inboxItems.deletedAt),
        ne(inboxItems.status, 'converted'),
      ),
    )
    .orderBy(desc(inboxItems.capturedAt));
  const materials: OutcomeMaterial[] = materialRows.map((m) => ({
    id: m.id,
    title: m.title,
    excerpt: m.excerpt,
    siteName: m.siteName,
    source: m.source as OutcomeMaterial['source'],
    status: m.status as OutcomeMaterial['status'],
    capturedAt: m.capturedAt.toISOString(),
  }));

  const taskIds = taskRows.map((r) => r.id);
  const actionConds: SQL[] = [
    and(eq(agentActions.targetType, 'outcome'), eq(agentActions.targetId, id)) as SQL,
  ];
  if (taskIds.length > 0) {
    actionConds.push(
      and(eq(agentActions.targetType, 'task'), inArray(agentActions.targetId, taskIds)) as SQL,
    );
  }
  if (linkedHabits.length > 0) {
    actionConds.push(
      and(
        eq(agentActions.targetType, 'habit'),
        inArray(
          agentActions.targetId,
          linkedHabits.map((habit) => habit.id),
        ),
      ) as SQL,
    );
  }
  const actionRows = await getDb()
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.userId, userId), or(...actionConds)))
    .orderBy(desc(agentActions.createdAt))
    .limit(DETAIL_ACTIONS_LIMIT);
  const names = await targetNamesFor(userId, actionRows);

  return {
    outcome: toOutcomeDto(row, stats.get(id)),
    tasks: taskRows.map((r) => toTaskDto(r, tagsByTask.get(r.id) ?? [])),
    habits: linkedHabits,
    materials,
    agentActions: actionRows.map((action) => ({
      ...toAgentActionDto(action),
      targetName: names.get(action.targetId) ?? null,
      payloadSummary: summarizePayload(action.actionType, action.payload),
    })),
  };
}

interface OpenRuleTask extends NextStepTask {
  outcomeId: string;
  habitId: string | null;
}

interface OutcomeRuleContext {
  openByOutcome: Map<string, OpenRuleTask[]>;
  completionsByOutcome: Map<string, Date[]>;
  lastTaskActivityByOutcome: Map<string, Date | null>;
}

interface OutcomeRuleFields {
  ruleSignal: OutcomeSignal;
  ruleNextStep: string | null;
  lastActivityAt: Date | null;
}

function asInstant(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (a && b) return a > b ? a : b;
  return a ?? b;
}

/** Open tasks, 14d completions, and last activity — one query each, grouped in memory. */
async function loadOutcomeRuleContext(
  userId: string,
  outcomeIds: string[],
  now: Date,
): Promise<OutcomeRuleContext> {
  const openByOutcome = new Map<string, OpenRuleTask[]>();
  const completionsByOutcome = new Map<string, Date[]>();
  const lastTaskActivityByOutcome = new Map<string, Date | null>();
  for (const id of outcomeIds) {
    openByOutcome.set(id, []);
    completionsByOutcome.set(id, []);
    lastTaskActivityByOutcome.set(id, null);
  }
  if (outcomeIds.length === 0) {
    return { openByOutcome, completionsByOutcome, lastTaskActivityByOutcome };
  }

  const openRows = await getDb()
    .select({
      outcomeId: tasks.outcomeId,
      title: tasks.title,
      status: tasks.status,
      dueAt: tasks.dueAt,
      priority: tasks.priority,
      isAllDay: tasks.isAllDay,
      habitId: tasks.habitId,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.outcomeId, outcomeIds),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['todo', 'doing']),
      ),
    );
  for (const row of openRows) {
    if (!row.outcomeId) continue;
    const list = openByOutcome.get(row.outcomeId);
    if (!list) continue;
    list.push({
      outcomeId: row.outcomeId,
      title: row.title,
      status: row.status,
      dueAt: row.dueAt,
      priority: row.priority,
      isAllDay: row.isAllDay,
      habitId: row.habitId,
    });
  }

  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  const doneRows = await getDb()
    .select({ outcomeId: tasks.outcomeId, completedAt: taskCompletions.completedAt })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.outcomeId, outcomeIds),
        gte(taskCompletions.completedAt, twoWeeksAgo),
      ),
    );
  for (const row of doneRows) {
    if (!row.outcomeId) continue;
    const at = asInstant(row.completedAt);
    if (!at) continue;
    const list = completionsByOutcome.get(row.outcomeId);
    if (list) list.push(at);
  }

  const activityRows = await getDb()
    .select({
      outcomeId: tasks.outcomeId,
      last: sql<Date | string | null>`max(${tasks.updatedAt})`,
    })
    .from(tasks)
    .where(
      and(eq(tasks.userId, userId), inArray(tasks.outcomeId, outcomeIds), isNull(tasks.deletedAt)),
    )
    .groupBy(tasks.outcomeId);
  for (const row of activityRows) {
    if (!row.outcomeId) continue;
    lastTaskActivityByOutcome.set(row.outcomeId, asInstant(row.last));
  }

  return { openByOutcome, completionsByOutcome, lastTaskActivityByOutcome };
}

function ruleFieldsForOutcome(
  outcomeId: string,
  ctx: OutcomeRuleContext,
  habitFacts: HabitHeadlineFact[],
  now: Date,
  timezone: string,
): OutcomeRuleFields {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const openTasks = ctx.openByOutcome.get(outcomeId) ?? [];
  const doneAt = ctx.completionsByOutcome.get(outcomeId) ?? [];
  const completedLast7d = doneAt.filter((at) => at >= weekAgo).length;
  const completedPrev7d = doneAt.length - completedLast7d;
  const lastDone = doneAt.reduce<Date | null>(
    (acc, at) => (acc === null || at > acc ? at : acc),
    null,
  );
  const lastActivityAt = laterOf(ctx.lastTaskActivityByOutcome.get(outcomeId) ?? null, lastDone);

  const linkedHabits = linkedHabitFacts(habitFacts, outcomeId);
  const habitDaysLast7d = linkedHabits.reduce((sum, habit) => sum + habit.daysDoneLast7d, 0);
  const habitDaysPrev7d = linkedHabits.reduce((sum, habit) => sum + habit.daysDonePrev7d, 0);
  const habitLast = linkedHabits.reduce<Date | null>((acc, habit) => {
    if (!habit.lastCompletedAt) return acc;
    return acc === null || habit.lastCompletedAt > acc ? habit.lastCompletedAt : acc;
  }, null);
  const lastActivityWithHabits = laterOf(lastActivityAt, habitLast);
  const incompleteHabit = linkedHabits.find((habit) => habit.todayDone < habit.todayTarget);

  const facts: OutcomeFacts = {
    completedLast7d: completedLast7d + habitDaysLast7d,
    completedPrev7d: completedPrev7d + habitDaysPrev7d,
    openCount: openTasks.length,
    overdueCount: openTasks.filter((t) => isOverdue(t.dueAt, t.isAllDay, now, timezone)).length,
    lastActivityAt: lastActivityWithHabits,
  };

  return {
    ruleSignal: computeSignal(facts, now),
    ruleNextStep: selectRuleNextStep(openTasks, now, timezone) ?? incompleteHabit?.name ?? null,
    lastActivityAt: lastActivityWithHabits,
  };
}

function statsFromRuleContext(
  outcomeIds: string[],
  ctx: OutcomeRuleContext,
  habitFacts: HabitHeadlineFact[],
  materialCounts: Map<string, number>,
  now: Date,
): Map<string, OutcomeStats> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const map = new Map<string, OutcomeStats>();
  for (const id of outcomeIds) {
    const openCount = (ctx.openByOutcome.get(id) ?? []).filter((task) => task.habitId === null).length;
    const completedLast7d = (ctx.completionsByOutcome.get(id) ?? []).filter((at) => at >= weekAgo)
      .length;
    const habitDays = linkedHabitFacts(habitFacts, id).reduce(
      (sum, habit) => sum + habit.daysDoneLast7d,
      0,
    );
    map.set(id, {
      openTaskCount: openCount,
      completedLast7d: completedLast7d + habitDays,
      materialCount: materialCounts.get(id) ?? 0,
    });
  }
  return map;
}

/** Recompute and store the deterministic rule-layer fields for one thread. */
export async function refreshOutcomeRuleFields(
  userId: string,
  outcomeId: string,
  now = new Date(),
): Promise<void> {
  // All-day overdue checks are calendar-date based, so the user's zone matters here.
  const timezone = (await getUserEntity(userId)).timezone;
  const habitFacts = await loadHabitHeadlineFacts(userId, timezone, now);
  const ctx = await loadOutcomeRuleContext(userId, [outcomeId], now);
  const fields = ruleFieldsForOutcome(outcomeId, ctx, habitFacts, now, timezone);

  await getDb()
    .update(outcomes)
    .set({
      ruleSignal: fields.ruleSignal,
      ruleNextStep: fields.ruleNextStep,
      ruleUpdatedAt: now,
      lastActivityAt: fields.lastActivityAt,
      updatedAt: now,
    })
    .where(eq(outcomes.id, outcomeId));
}

/** Recompute rule fields for the thread a task belongs to (and its previous thread). */
export async function refreshOutcomeRulesForTask(
  userId: string,
  outcomeId: string | null,
  previousOutcomeId?: string | null,
): Promise<void> {
  if (outcomeId) await refreshOutcomeRuleFields(userId, outcomeId);
  if (previousOutcomeId && previousOutcomeId !== outcomeId) {
    await refreshOutcomeRuleFields(userId, previousOutcomeId);
  }
}

async function todayPulse(userId: string, timezone: string): Promise<TodayPulse> {
  const [inboxRow] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(inboxItems)
    .where(and(eq(inboxItems.userId, userId), eq(inboxItems.status, 'unread'), isNull(inboxItems.deletedAt)));

  const daily = await getDb()
    .select({ id: reports.id, periodStart: reports.periodStart })
    .from(reports)
    .where(
      and(
        eq(reports.userId, userId),
        eq(reports.type, 'daily'),
        ne(reports.bodyMd, ''),
      ),
    )
    .orderBy(desc(reports.periodStart))
    .limit(120);
  const today = DateTime.now().setZone(timezone).toISODate();
  const written = new Set(daily.map((r) => r.periodStart));
  let streak = 0;
  let cursor = today;
  if (cursor && !written.has(cursor)) {
    // Today isn't written yet — don't break the streak, start from yesterday.
    cursor = DateTime.fromISO(cursor).minus({ days: 1 }).toISODate();
  }
  while (cursor && written.has(cursor)) {
    streak += 1;
    cursor = DateTime.fromISO(cursor).minus({ days: 1 }).toISODate();
  }

  return {
    inboxPending: inboxRow?.n ?? 0,
    reportStreak: streak,
    todayReportId: today && written.has(today) ? (daily.find((r) => r.periodStart === today)?.id ?? null) : null,
  };
}

export async function getTodayDashboard(userId: string, timezone: string): Promise<TodayDashboard> {
  const now = new Date();
  const rows = await getDb()
    .select()
    .from(outcomes)
    .where(and(eq(outcomes.userId, userId), eq(outcomes.status, 'open')))
    .orderBy(asc(outcomes.sortOrder), asc(outcomes.createdAt));
  const outcomeIds = rows.map((r) => r.id);

  // Compute in memory: overdue / habit-today depend on `now`, so a write would still go stale.
  const [entity, habitFacts, ctx, materialCounts] = await Promise.all([
    getUserEntity(userId),
    loadHabitHeadlineFacts(userId, timezone, now),
    loadOutcomeRuleContext(userId, outcomeIds, now),
    loadMaterialCounts(userId, outcomeIds),
  ]);
  const stats = statsFromRuleContext(outcomeIds, ctx, habitFacts, materialCounts, now);
  const fresh = rows.map((row) => {
    const fields = ruleFieldsForOutcome(row.id, ctx, habitFacts, now, timezone);
    return {
      ...row,
      ruleSignal: fields.ruleSignal,
      ruleNextStep: fields.ruleNextStep,
      lastActivityAt: fields.lastActivityAt,
    };
  });

  const [todayTasks, pulse, habitWindowRows] = await Promise.all([
    listTasks(userId, { listId: 'smart:today', limit: 100 }).then((r) => r.items),
    todayPulse(userId, timezone),
    getDb()
      .select({ start: habits.windowStart, end: habits.windowEnd })
      .from(habits)
      .where(and(eq(habits.userId, userId), eq(habits.active, true))),
  ]);

  // "当下" card: rule layer only for now; the agent layer may later rewrite the reason.
  const signalByOutcome = new Map(fresh.map((row) => [row.id, asSignal(row.ruleSignal)]));
  const nowCard = computeNow({
    now,
    timezone,
    tasks: todayTasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      estimateMinutes: task.estimateMinutes,
      dueAt: task.dueAt ? new Date(task.dueAt) : null,
      isAllDay: task.isAllDay,
      outcomeId: task.outcomeId,
      outcomeSignal: task.outcomeId ? (signalByOutcome.get(task.outcomeId) ?? null) : null,
    })),
    habitWindows: habitWindowRows.flatMap((row) =>
      row.start !== null && row.end !== null ? [{ start: row.start, end: row.end }] : [],
    ),
    quietHoursStart: entity.quietHoursStart,
    quietHoursEnd: entity.quietHoursEnd,
  });

  return {
    outcomes: fresh.map((row) => toOutcomeDto(row, stats.get(row.id))),
    tasks: todayTasks,
    pulse,
    now: nowCard,
    generatedAt: now.toISOString(),
  };
}
