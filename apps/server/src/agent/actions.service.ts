import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type {
  ActionFeedbackInput,
  AgentAction,
  AgentActionLogItem,
  AgentActionsQuery,
} from '@vital/dto';
import { getDb } from '../db/index.js';
import { agentActions, habits, outcomes, tasks, type AgentActionRow } from '../db/schema.js';
import { AppError } from '../errors.js';

/** Hard cap for the actions listing — the ledger is append-only and chatty. */
const LIST_ACTIONS_LIMIT = 50;

function toAgentActionDto(row: AgentActionRow): AgentAction {
  return {
    id: row.id,
    actionType: row.actionType as AgentAction['actionType'],
    targetType: row.targetType as AgentAction['targetType'],
    targetId: row.targetId,
    payload: row.payload,
    feedback: row.feedback as AgentAction['feedback'],
    feedbackPayload: row.feedbackPayload ?? null,
    feedbackAt: row.feedbackAt ? row.feedbackAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Distill the stored payload into a one-line summary per action type.
 * Returns '' when the payload has nothing readable; the client shows a placeholder.
 */
function summarizePayload(actionType: string, payload: Record<string, unknown>): string {
  const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  switch (actionType) {
    case 'outcome.create':
      return str(payload['name']);
    case 'outcome.headline':
      return str(payload['headline']);
    case 'outcome.suggestion':
      return str(payload['suggestion']);
    case 'task.decompose': {
      const subtasks = Array.isArray(payload['subtasks']) ? payload['subtasks'] : [];
      return subtasks
        .map((s) =>
          s && typeof s === 'object' ? str((s as Record<string, unknown>)['title']) : '',
        )
        .filter((title) => title !== '')
        .join('、');
    }
    default: {
      // habit.* have no producers yet — fall back to a name-ish field, then raw JSON.
      const name = str(payload['name']) || str(payload['hint']) || str(payload['content']);
      if (name !== '') return name;
      const raw = JSON.stringify(payload);
      return raw.length > 120 ? `${raw.slice(0, 117)}…` : raw;
    }
  }
}

/** Resolve target names in bulk; missing targets (deleted / undone) simply stay absent. */
async function targetNamesFor(
  userId: string,
  rows: AgentActionRow[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const idsByType = new Map<string, string[]>();
  for (const row of rows) {
    const list = idsByType.get(row.targetType) ?? [];
    list.push(row.targetId);
    idsByType.set(row.targetType, list);
  }
  const db = getDb();
  const outcomeIds = idsByType.get('outcome') ?? [];
  if (outcomeIds.length > 0) {
    const found = await db
      .select({ id: outcomes.id, name: outcomes.name })
      .from(outcomes)
      .where(and(eq(outcomes.userId, userId), inArray(outcomes.id, outcomeIds)));
    for (const row of found) map.set(row.id, row.name);
  }
  const taskIds = idsByType.get('task') ?? [];
  if (taskIds.length > 0) {
    // Soft-deleted tasks keep their title — the name is still the best label.
    const found = await db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, taskIds)));
    for (const row of found) map.set(row.id, row.title);
  }
  const habitIds = idsByType.get('habit') ?? [];
  if (habitIds.length > 0) {
    const found = await db
      .select({ id: habits.id, name: habits.name })
      .from(habits)
      .where(and(eq(habits.userId, userId), inArray(habits.id, habitIds)));
    for (const row of found) map.set(row.id, row.name);
  }
  return map;
}

/**
 * List the caller's agent actions, newest first. All filters are optional and
 * combine with AND; rows always stay scoped to the caller. Each row is enriched
 * with the joined target name (null once deleted/undone) and a payload digest.
 */
export async function listAgentActions(
  userId: string,
  query: AgentActionsQuery,
): Promise<AgentActionLogItem[]> {
  const rows = await getDb()
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.userId, userId),
        query.days !== undefined
          ? gte(agentActions.createdAt, new Date(Date.now() - query.days * 24 * 3600 * 1000))
          : undefined,
        query.targetType ? eq(agentActions.targetType, query.targetType) : undefined,
        query.targetId ? eq(agentActions.targetId, query.targetId) : undefined,
        query.actionType ? eq(agentActions.actionType, query.actionType) : undefined,
        query.feedback ? eq(agentActions.feedback, query.feedback) : undefined,
      ),
    )
    .orderBy(desc(agentActions.createdAt))
    .limit(LIST_ACTIONS_LIMIT);
  const names = await targetNamesFor(userId, rows);
  return rows.map((row) => ({
    ...toAgentActionDto(row),
    targetName: names.get(row.targetId) ?? null,
    payloadSummary: summarizePayload(row.actionType, row.payload),
  }));
}

/**
 * Record user feedback on a proposal. 'edited' additionally applies the edited
 * payload in the same transaction (rename outcome / override headline etc.).
 * For 'task.decompose' the web client materializes subtasks via the normal
 * task API before sending 'accepted'/'edited' — here we only bookkeep.
 */
export async function applyActionFeedback(
  userId: string,
  actionId: string,
  input: ActionFeedbackInput,
): Promise<AgentAction> {
  const db = getDb();
  const [row] = await db.select().from(agentActions).where(eq(agentActions.id, actionId)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'NOT_FOUND');
  if (row.feedback !== 'pending') throw AppError.of(409, 'VALIDATION_ERROR');
  if (input.feedback === 'edited' && input.editedPayload === undefined) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }

  const now = new Date();
  const next = await db.transaction(async (tx) => {
    if (input.feedback === 'edited' && input.editedPayload) {
      const p = input.editedPayload;
      if (row.actionType === 'outcome.headline' && typeof p['headline'] === 'string') {
        await tx
          .update(outcomes)
          .set({ agentHeadline: p['headline'].slice(0, 500), agentUpdatedAt: now, updatedAt: now })
          .where(and(eq(outcomes.id, row.targetId), eq(outcomes.userId, userId)));
      } else if (row.actionType === 'outcome.suggestion' && typeof p['suggestion'] === 'string') {
        await tx
          .update(outcomes)
          .set({
            agentSuggestion: p['suggestion'].slice(0, 1000),
            agentUpdatedAt: now,
            updatedAt: now,
          })
          .where(and(eq(outcomes.id, row.targetId), eq(outcomes.userId, userId)));
      } else if (row.actionType === 'outcome.create' && typeof p['name'] === 'string') {
        await tx
          .update(outcomes)
          .set({ name: p['name'].trim().slice(0, 120), updatedAt: now })
          .where(and(eq(outcomes.id, row.targetId), eq(outcomes.userId, userId)));
      }
    }
    const [updated] = await tx
      .update(agentActions)
      .set({
        feedback: input.feedback,
        feedbackPayload: input.editedPayload ?? null,
        feedbackAt: now,
      })
      .where(and(eq(agentActions.id, row.id), eq(agentActions.feedback, 'pending')))
      .returning();
    if (!updated) throw AppError.of(409, 'VALIDATION_ERROR');
    return updated;
  });
  return toAgentActionDto(next);
}
