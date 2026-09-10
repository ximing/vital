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
  Task,
  TodayDashboard,
  TodayPulse,
} from '@vital/dto';
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
import { listTasks } from '../tasks/tasks.service.js';
import { toTaskDto } from '../tasks/task-dto.js';
import { computeNow } from './now-engine.js';
import { computeSignal, isOverdue, selectRuleNextStep, type OutcomeFacts } from './rule-engine.js';
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
    if (row.outcomeId) {
      const rec = map.get(row.outcomeId);
      if (rec) rec.materialCount = row.n;
    }
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
  }
  const stats = await statsForOutcomes(userId, [id]);
  if (!next) throw AppError.of(404, 'NOT_FOUND');
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

  const taskRows = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.outcomeId, id), isNull(tasks.deletedAt)))
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
    materials,
    agentActions: actionRows.map((action) => ({
      ...toAgentActionDto(action),
      targetName: names.get(action.targetId) ?? null,
      payloadSummary: summarizePayload(action.actionType, action.payload),
    })),
  };
}

/** Recompute and store the deterministic rule-layer fields for one thread. */
export async function refreshOutcomeRuleFields(
  userId: string,
  outcomeId: string,
  now = new Date(),
): Promise<void> {
  // All-day overdue checks are calendar-date based, so the user's zone matters here.
  const timezone = (await getUserEntity(userId)).timezone;
  const openTasks = await getDb()
    .select({
      title: tasks.title,
      status: tasks.status,
      dueAt: tasks.dueAt,
      priority: tasks.priority,
      isAllDay: tasks.isAllDay,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.outcomeId, outcomeId),
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['todo', 'doing']),
      ),
    );

  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
  const doneRows = await getDb()
    .select({ completedAt: taskCompletions.completedAt })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.outcomeId, outcomeId),
        gte(taskCompletions.completedAt, twoWeeksAgo),
      ),
    );
  const completedLast7d = doneRows.filter((r) => r.completedAt >= weekAgo).length;
  const completedPrev7d = doneRows.length - completedLast7d;

  const [activity] = await getDb()
    .select({ last: sql<Date | string | null>`max(${tasks.updatedAt})` })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.outcomeId, outcomeId), isNull(tasks.deletedAt)));
  // Raw sql<> aggregates come back untyped (string), coerce defensively.
  const lastTaskActivity = activity?.last ? new Date(activity.last) : null;
  const lastDone = doneRows.reduce<Date | null>((acc, r) => {
    const at = r.completedAt instanceof Date ? r.completedAt : new Date(r.completedAt);
    return acc === null || at > acc ? at : acc;
  }, null);
  const lastActivityAt =
    lastTaskActivity && lastDone
      ? lastTaskActivity > lastDone
        ? lastTaskActivity
        : lastDone
      : (lastTaskActivity ?? lastDone);

  const facts: OutcomeFacts = {
    completedLast7d,
    completedPrev7d,
    openCount: openTasks.length,
    overdueCount: openTasks.filter((t) => isOverdue(t.dueAt, t.isAllDay, now, timezone)).length,
    lastActivityAt,
  };

  await getDb()
    .update(outcomes)
    .set({
      ruleSignal: computeSignal(facts, now),
      ruleNextStep: selectRuleNextStep(openTasks, now, timezone),
      ruleUpdatedAt: now,
      lastActivityAt,
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
  const rows = await getDb()
    .select()
    .from(outcomes)
    .where(and(eq(outcomes.userId, userId), eq(outcomes.status, 'open')))
    .orderBy(asc(outcomes.sortOrder), asc(outcomes.createdAt));

  // Read-through: rule layer is always fresh, agent fields are read as materialized.
  for (const row of rows) {
    await refreshOutcomeRuleFields(userId, row.id);
  }
  const fresh = await getDb()
    .select()
    .from(outcomes)
    .where(and(eq(outcomes.userId, userId), eq(outcomes.status, 'open')))
    .orderBy(asc(outcomes.sortOrder), asc(outcomes.createdAt));
  const stats = await statsForOutcomes(
    userId,
    fresh.map((r) => r.id),
  );

  const todayTasks: Task[] = await listTasks(userId, {
    listId: 'smart:today',
    limit: 100,
  }).then((r) => r.items);

  const pulse = await todayPulse(userId, timezone);

  // "当下" card: rule layer only for now; the agent layer may later rewrite the reason.
  const entity = await getUserEntity(userId);
  const habitWindowRows = await getDb()
    .select({ start: habits.windowStart, end: habits.windowEnd })
    .from(habits)
    .where(and(eq(habits.userId, userId), eq(habits.active, true)));
  const signalByOutcome = new Map(fresh.map((row) => [row.id, asSignal(row.ruleSignal)]));
  const now = computeNow({
    now: new Date(),
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
    now,
    generatedAt: new Date().toISOString(),
  };
}
