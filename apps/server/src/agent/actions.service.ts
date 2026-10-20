import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { retireSupersededWording } from './action-ledger.js';
import type {
  ActionFeedbackInput,
  AgentAction,
  AgentActionLogItem,
  AgentActionsQuery,
} from '@vital/dto';
import { getUserEntity } from '../auth/auth.service.js';
import { getDb } from '../db/index.js';
import {
  agentActions,
  habits,
  outcomes,
  reports,
  tasks,
  type AgentActionRow,
  type TaskRow,
} from '../db/schema.js';
import { enqueueOutcomeRefresh, type AgentDb } from './jobs.js';
import { markAgentSchedule } from './scheduling.js';
import { lockAgentUser } from './user-lock.js';
import { syncTaskNotifications } from '../notifications/outbox.js';
import { indexTask, removeTaskIndex, trackTaskIndexJob } from '../retrieval/tasks.js';
import { nextSortOrder } from '../tasks/sort-order.js';
import { AppError } from '../errors.js';
import { trackIndexJob } from '../retrieval/pipeline.js';
import { removeOutcomeIndex } from '../retrieval/search.js';
import { removeAgentOutcome } from '../outcomes/remove-agent-outcome.js';

/** Hard cap for the actions listing — the ledger is append-only and chatty. */
const LIST_ACTIONS_LIMIT = 50;

export function toAgentActionDto(row: AgentActionRow): AgentAction {
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
export function summarizePayload(actionType: string, payload: Record<string, unknown>): string {
  const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  switch (actionType) {
    case 'outcome.create':
      return str(payload['name']);
    case 'outcome.headline':
      return str(payload['headline']);
    case 'outcome.suggestion':
      return str(payload['suggestion']);
    case 'task.followup':
      return '已追问，7 天内不再问';
    case 'task.decompose': {
      const subtasks = Array.isArray(payload['subtasks']) ? payload['subtasks'] : [];
      return subtasks
        .map((s) =>
          s && typeof s === 'object' ? str((s as Record<string, unknown>)['title']) : '',
        )
        .filter((title) => title !== '')
        .join('、');
    }
    case 'task.draft': {
      const draft = str(payload['draft']);
      const firstLine = draft.split('\n')[0] ?? '';
      if (firstLine !== '') {
        return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
      }
      const subtasks = Array.isArray(payload['subtasks']) ? payload['subtasks'] : [];
      return subtasks
        .map((s) =>
          s && typeof s === 'object' ? str((s as Record<string, unknown>)['title']) : '',
        )
        .filter((title) => title !== '')
        .join('、');
    }
    case 'report.generate': {
      const notes = str(payload['notes']);
      const firstLine = notes.split('\n')[0] ?? '';
      return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
    }
    case 'errand.summarize':
    case 'errand.organize':
    case 'errand.propose': {
      const text = str(payload['summary']) || str(payload['note']) || str(payload['reason']);
      const firstLine = text.split('\n')[0] ?? '';
      return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
    }
    case 'habit.adjust': {
      const habitName = str(payload['name']);
      const outcomeName = str(payload['outcomeName']);
      if (habitName !== '' && outcomeName !== '') return `把「${habitName}」挂到「${outcomeName}」`;
      return outcomeName !== '' ? `挂到「${outcomeName}」` : habitName;
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
export async function targetNamesFor(
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
  const reportIds = idsByType.get('report') ?? [];
  if (reportIds.length > 0) {
    const found = await db
      .select({ id: reports.id, title: reports.title })
      .from(reports)
      .where(and(eq(reports.userId, userId), inArray(reports.id, reportIds)));
    for (const row of found) map.set(row.id, row.title);
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
  await retireSupersededWording(userId);
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

type ProposedSubtask = { title: string; estimateMinutes: number | null };

/** Defensive parse of a decompose/draft payload — the ledger stores free-form jsonb. */
function parseDecomposeSubtasks(payload: Record<string, unknown>): ProposedSubtask[] {
  const raw = payload['subtasks'];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ProposedSubtask[] => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    if (typeof record['title'] !== 'string' || record['title'].trim() === '') return [];
    const estimate = record['estimateMinutes'];
    return [
      {
        title: record['title'].trim().slice(0, 500),
        estimateMinutes: typeof estimate === 'number' && estimate > 0 ? estimate : null,
      },
    ];
  });
}

/**
 * Insert proposed children under `parent`. No-op for nested tasks (one level of
 * subtasks only) or an empty list. Caller records the returned rows for undo.
 */
async function materializeProposedSubtasks(
  tx: AgentDb,
  userId: string,
  parent: TaskRow,
  subtasks: ProposedSubtask[],
  now: Date,
): Promise<TaskRow[]> {
  if (parent.parentId !== null || subtasks.length === 0) return [];
  const createdRows: TaskRow[] = [];
  const user = await getUserEntity(userId);
  for (const subtask of subtasks) {
    const [created] = await tx
      .insert(tasks)
      .values({
        id: randomUUID(),
        userId,
        listId: parent.listId,
        parentId: parent.id,
        outcomeId: parent.outcomeId,
        estimateMinutes: subtask.estimateMinutes,
        title: subtask.title,
        notesMd: '',
        status: 'todo',
        priority: 3,
        pinned: false,
        isAllDay: false,
        timezone: parent.timezone,
        sortOrder: await nextSortOrder(parent.listId, parent.id, tx),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (created) {
      createdRows.push(created);
      await syncTaskNotifications(
        {
          id: created.id,
          userId: created.userId,
          listId: created.listId,
          title: created.title,
          status: created.status,
          dueAt: created.dueAt ?? null,
          reminderMode: created.reminderMode ?? null,
          reminderOffsetMinutes: created.reminderOffsetMinutes ?? null,
          reminderAt: created.reminderAt ?? null,
          isAllDay: created.isAllDay,
          timezone: created.timezone,
          deletedAt: created.deletedAt ?? null,
          createdAt: created.createdAt,
        },
        user,
        now,
        tx,
      );
    }
  }
  if (parent.outcomeId) await enqueueOutcomeRefresh(tx, userId, parent.outcomeId, now);
  return createdRows;
}

/** Put the previous sentence back when the user dismisses the one on screen. */
async function restoreOutcomeCopy(
  tx: AgentDb,
  userId: string,
  outcomeId: string,
  field: 'agentHeadline' | 'agentSuggestion',
  written: unknown,
  previous: unknown,
  now: Date,
): Promise<void> {
  const [current] = await tx
    .select({
      agentHeadline: outcomes.agentHeadline,
      agentSuggestion: outcomes.agentSuggestion,
    })
    .from(outcomes)
    .where(and(eq(outcomes.id, outcomeId), eq(outcomes.userId, userId)))
    .limit(1)
    .for('update');
  if (!current) return;
  const live = field === 'agentHeadline' ? current.agentHeadline : current.agentSuggestion;
  if (typeof written === 'string' && live !== written) return;
  const next = typeof previous === 'string' && previous.trim() !== '' ? previous : null;
  await tx
    .update(outcomes)
    .set({
      ...(field === 'agentHeadline' ? { agentHeadline: next } : { agentSuggestion: next }),
      agentUpdatedAt: now,
      updatedAt: now,
    })
    .where(and(eq(outcomes.id, outcomeId), eq(outcomes.userId, userId)));
}

/**
 * Record user feedback on a proposal. 'edited' additionally applies the edited
 * payload in the same transaction (rename outcome / override headline etc.).
 * For 'task.decompose', 'accepted' materializes the proposed subtasks inside
 * the same transaction and records their ids in feedbackPayload.materialized
 * (the undo endpoint compensates with a soft delete). For 'task.draft',
 * 'accepted' appends the draft to the task notes and materializes any proposed
 * subtasks the same way.
 */
export async function applyActionFeedback(
  userId: string,
  actionId: string,
  input: ActionFeedbackInput,
): Promise<AgentAction> {
  const db = getDb();
  const [row] = await db.select().from(agentActions).where(and(eq(agentActions.id, actionId), eq(agentActions.userId, userId))).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'NOT_FOUND');
  if (row.feedback !== 'pending') throw AppError.of(409, 'VALIDATION_ERROR');
  if (input.feedback === 'edited' && input.editedPayload === undefined) {
    throw AppError.of(400, 'VALIDATION_ERROR');
  }

  const now = new Date();
  const materialized: TaskRow[] = [];
  const removedOutcomeIds: string[] = [];
  const next = await db.transaction(async (tx) => {
    await lockAgentUser(tx, userId);
    if (input.feedback === 'accepted' && row.actionType === 'outcome.create') {
      await tx
        .update(outcomes)
        .set({ undoUntil: null, updatedAt: now })
        .where(
          and(eq(outcomes.id, row.targetId), eq(outcomes.userId, userId), eq(outcomes.createdBy, 'agent')),
        );
    }
    if (input.feedback === 'dismissed' && row.actionType === 'outcome.create') {
      const removed = await removeAgentOutcome(tx, userId, row.targetId, now, row.id);
      if (removed) removedOutcomeIds.push(row.targetId);
    }
    if (input.feedback === 'dismissed' && row.actionType === 'outcome.headline') {
      await restoreOutcomeCopy(tx, userId, row.targetId, 'agentHeadline', row.payload['headline'], row.payload['previousHeadline'], now);
    }
    if (input.feedback === 'dismissed' && row.actionType === 'outcome.suggestion') {
      await restoreOutcomeCopy(tx, userId, row.targetId, 'agentSuggestion', row.payload['suggestion'], row.payload['previousSuggestion'], now);
    }
    if (input.feedback === 'accepted' && row.actionType === 'task.decompose') {
      const subtasks = parseDecomposeSubtasks(row.payload);
      if (subtasks.length > 0) {
        const [parent] = await tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, row.targetId), eq(tasks.userId, userId)))
          .limit(1);
        if (!parent || parent.deletedAt) {
          // Without a parent there is nothing to attach the subtasks to — the
          // transaction aborts and the proposal stays pending.
          throw AppError.of(409, 'VALIDATION_ERROR', { reason: 'parent task no longer exists' });
        }
        materialized.push(...(await materializeProposedSubtasks(tx, userId, parent, subtasks, now)));
      }
    }
    if (input.feedback === 'accepted' && row.actionType === 'task.draft') {
      const draft = typeof row.payload['draft'] === 'string' ? row.payload['draft'].trim() : '';
      const subtasks = parseDecomposeSubtasks(row.payload);
      const [task] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, row.targetId), eq(tasks.userId, userId)))
        .limit(1);
      if (task && !task.deletedAt) {
        if (draft !== '') {
          const base = task.notesMd.trimEnd();
          const notes = (base === '' ? draft : `${base}\n\n${draft}`).slice(0, 50_000);
          await tx
            .update(tasks)
            .set({ notesMd: notes, updatedAt: now })
            .where(eq(tasks.id, task.id));
        }
        materialized.push(...(await materializeProposedSubtasks(tx, userId, task, subtasks, now)));
      }
    }
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
    const feedbackPayload =
      input.feedback === 'accepted' && materialized.length > 0
        ? { materialized: { taskIds: materialized.map((t) => t.id) } }
        : (input.editedPayload ?? null);
    const [updated] = await tx
      .update(agentActions)
      .set({
        feedback: input.feedback,
        feedbackPayload,
        feedbackAt: now,
      })
      .where(and(eq(agentActions.id, row.id), eq(agentActions.userId, userId), eq(agentActions.feedback, 'pending')))
      .returning();
    if (!updated) throw AppError.of(409, 'VALIDATION_ERROR');
    await markAgentSchedule(tx, userId, 'memory.distill', { now, urgent: input.feedback !== 'accepted' });
    return updated;
  });
  for (const outcomeId of removedOutcomeIds) {
    trackIndexJob(removeOutcomeIndex(outcomeId), 'removeOutcomeIndex');
  }
  // Fire-and-forget retrieval indexing, mirroring createTask.
  if (materialized.length > 0) {
    trackTaskIndexJob(
      (async () => {
        for (const row of materialized) {
          await indexTask(row).catch((err: unknown) => {
            console.error('[retrieval] materialize indexTask failed', err);
          });
        }
      })(),
    );
  }
  return toAgentActionDto(next);
}

/** Task ids recorded by an accepted, materialized decompose proposal, if any. */
function materializedTaskIdsOf(row: AgentActionRow): string[] | null {
  const materialized = row.feedbackPayload?.['materialized'];
  if (materialized === null || typeof materialized !== 'object') return null;
  const taskIds = (materialized as Record<string, unknown>)['taskIds'];
  if (!Array.isArray(taskIds) || taskIds.length === 0) return null;
  if (!taskIds.every((id): id is string => typeof id === 'string')) return null;
  return taskIds;
}

/**
 * Compensate a materialized acceptance: soft-delete every materialized subtask
 * and settle the action as 'undone' (a terminal state and a strong correction
 * signal for memory.distill). The materialized record is kept for audit.
 */
export async function undoAgentAction(userId: string, actionId: string): Promise<AgentAction> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(agentActions)
    .where(and(eq(agentActions.id, actionId), eq(agentActions.userId, userId)))
    .limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'NOT_FOUND');
  if (row.feedback !== 'accepted') throw AppError.of(409, 'VALIDATION_ERROR');
  const taskIds = materializedTaskIdsOf(row);
  if (taskIds === null) throw AppError.of(409, 'VALIDATION_ERROR');

  const now = new Date();
  const next = await db.transaction(async (tx) => {
    await lockAgentUser(tx, userId);
    const children = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, taskIds)));
    if (children.length !== taskIds.length) {
      throw AppError.of(409, 'VALIDATION_ERROR', { reason: 'some materialized subtasks no longer exist' });
    }
    for (const child of children) {
      if (child.deletedAt) {
        throw AppError.of(409, 'VALIDATION_ERROR', { reason: `subtask "${child.title}" was already deleted` });
      }
      if (child.status === 'done') {
        throw AppError.of(409, 'VALIDATION_ERROR', { reason: `subtask "${child.title}" was already completed` });
      }
    }
    const user = await getUserEntity(userId);
    await tx
      .update(tasks)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, taskIds)));
    for (const child of children) {
      await syncTaskNotifications({ ...child, deletedAt: now }, user, now, tx);
    }
    const outcomeIds = new Set(children.map((c) => c.outcomeId).filter((id): id is string => id !== null));
    for (const outcomeId of outcomeIds) {
      await enqueueOutcomeRefresh(tx, userId, outcomeId, now);
    }
    const [updated] = await tx
      .update(agentActions)
      .set({ feedback: 'undone', feedbackAt: now })
      .where(and(eq(agentActions.id, row.id), eq(agentActions.userId, userId), eq(agentActions.feedback, 'accepted')))
      .returning();
    if (!updated) throw AppError.of(409, 'VALIDATION_ERROR');
    await markAgentSchedule(tx, userId, 'memory.distill', { now, urgent: true });
    return updated;
  });
  trackTaskIndexJob(
    (async () => {
      for (const id of taskIds) {
        await removeTaskIndex(id).catch((err: unknown) => {
          console.error('[retrieval] undo removeTaskIndex failed', err);
        });
      }
    })(),
  );
  return toAgentActionDto(next);
}
