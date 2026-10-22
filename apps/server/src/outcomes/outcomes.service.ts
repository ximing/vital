import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type {
  CreateOutcomeInput,
  ListOutcomesQuery,
  Outcome,
  OutcomeDetail,
  OutcomeMaterial,
  PatchOutcomeInput,
} from '@vital/dto';
import { recordOutcomeRename } from '../agent/edit-events.service.js';
import { getDb } from '../db/index.js';
import {
  agentActions,
  inboxItems,
  outcomes,
  taskCompletions,
  tasks,
  taskTags,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getUserEntity } from '../auth/auth.service.js';
import { summarizePayload, targetNamesFor, toAgentActionDto } from '../agent/actions.service.js';
import { trackIndexJob } from '../retrieval/pipeline.js';
import { indexOutcome, removeOutcomeIndex } from '../retrieval/search.js';
import { listHabitsForOutcome } from '../habits/habits.service.js';
import { loadHabitHeadlineFacts } from '../habits/progress.js';
import { toTaskDto } from '../tasks/task-dto.js';
import { latestCompletionIdByTask } from '../tasks/tasks.shared.js';
import { removeAgentOutcome } from './remove-agent-outcome.js';
import {
  emptyOutcomeStats,
  loadMaterialCounts,
  toOutcomeDto,
  type OutcomeStats,
} from './outcome-dto.js';
import { refreshOutcomeRuleFields } from './rule-context.js';
import { getOwnedOutcomeOr404 } from './shared.js';

export { assertOwnedOutcomeId, getOwnedOutcomeOr404 } from './shared.js';

/** Per-outcome task/material counters for the board. */
async function statsForOutcomes(
  userId: string,
  outcomeIds: string[],
): Promise<Map<string, OutcomeStats>> {
  const map = new Map<string, OutcomeStats>();
  for (const id of outcomeIds) map.set(id, emptyOutcomeStats());
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

  const milestoneRows = await getDb()
    .select({ outcomeId: tasks.outcomeId, status: tasks.status })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.outcomeId, outcomeIds),
        eq(tasks.isMilestone, true),
        isNull(tasks.habitId),
        isNull(tasks.deletedAt),
      ),
    );
  for (const row of milestoneRows) {
    if (!row.outcomeId || row.status === 'canceled') continue;
    const rec = map.get(row.outcomeId);
    if (!rec) continue;
    rec.milestoneTotal += 1;
    if (row.status === 'done') rec.milestoneDone += 1;
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
  const removed = await getDb().transaction(async (tx) =>
    removeAgentOutcome(tx, userId, id, new Date()),
  );
  if (removed) trackIndexJob(removeOutcomeIndex(id), 'removeOutcomeIndex');
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
  const completions = await latestCompletionIdByTask(
    taskRows.filter((row) => row.status === 'done').map((row) => row.id),
  );

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
    tasks: taskRows.map((r) =>
      toTaskDto(r, tagsByTask.get(r.id) ?? [], completions.get(r.id) ?? null),
    ),
    habits: linkedHabits,
    materials,
    agentActions: actionRows.map((action) => ({
      ...toAgentActionDto(action),
      targetName: names.get(action.targetId) ?? null,
      payloadSummary: summarizePayload(action.actionType, action.payload),
    })),
  };
}

export {
  asSignal,
  loadMaterialCounts,
  toOutcomeDto,
} from './outcome-dto.js';
export {
  loadOutcomeRuleContext,
  refreshOutcomeRuleFields,
  refreshOutcomeRulesForTask,
  ruleFieldsForOutcome,
  statsFromRuleContext,
} from './rule-context.js';
export { getTodayDashboard } from './today-dashboard.js';
