import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import {
  agentActions,
  inboxItems,
  notificationOutbox,
  tags,
  taskCompletions,
  tasks,
  users,
  type AgentJobRow,
  type NotificationOutboxPayload,
  type TaskRow,
  type User,
} from '../../db/schema.js';
import { completeText, resolveModelFor } from '../../llm/pi.js';
import { loadLlmStore } from '../../llm/store.js';
import { applyQuietHours } from '../../notifications/quiet-hours.js';
import { syncTaskNotifications } from '../../notifications/outbox.js';
import { indexInboxItem } from '../../retrieval/search.js';
import { fireIndexTask } from '../../tasks/tasks.shared.js';
import { recordAgentAction } from '../action-ledger.js';
import { skipExecution } from '../executions.service.js';
import { enqueueOutcomeRefresh, enqueueTodayLayout } from '../jobs.js';
import { withAgentJobEffects } from '../job-runtime.js';
import { markAgentSchedule } from '../scheduling.js';
import {
  ERRAND_FAILED_TITLE,
  FAIL_TEXT,
  appendErrandNote,
  clipNotify,
  failMarker,
  proposeMarker,
  type ErrandFailCode,
  type ErrandKind,
} from './model.js';

export async function notifyRow(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  user: User,
  task: TaskRow,
  now: Date,
  input: { title: string; message: string; deeplink: string; key: string },
): Promise<void> {
  if (!user.notifyAgentErrand) return;
  const scheduledAt = applyQuietHours(now, user.quietHoursStart, user.quietHoursEnd, user.timezone);
  const payload: NotificationOutboxPayload = {
    title: input.title,
    listId: task.listId,
    listName: '',
    dueAt: null,
    remindAt: null,
    isAllDay: false,
    timezone: user.timezone,
    eventType: 'agent.errand',
    message: clipNotify(input.message),
    deeplink: input.deeplink,
    taskId: task.id,
  };
  await tx
    .insert(notificationOutbox)
    .values({
      id: randomUUID(),
      userId: user.id,
      eventType: 'agent.errand',
      entityType: 'task',
      entityId: task.id,
      occurrenceAt: now,
      idempotencyKey: input.key,
      scheduledAt,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      payload,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: notificationOutbox.idempotencyKey });
}

export async function freshUser(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  userId: string,
): Promise<User | null> {
  const [row] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}

export async function lockTask(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  userId: string,
  taskId: string,
): Promise<TaskRow | null> {
  const [row] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .for('update');
  return row ?? null;
}

export async function finishTask(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  user: User,
  task: TaskRow,
  notes: string,
  now: Date,
): Promise<void> {
  const recurring = task.recurrenceRrule !== null || task.recurrenceKind !== null;
  const complete = task.status !== 'done' && task.status !== 'canceled' && !recurring;
  if (complete) {
    await tx.insert(taskCompletions).values({
      id: randomUUID(),
      taskId: task.id,
      occurrenceAt: task.dueAt ?? now,
      completedAt: now,
      dueWasNull: task.dueAt === null,
    });
  }
  const status = complete ? 'done' : task.status;
  await tx
    .update(tasks)
    .set({
      notesMd: notes,
      status,
      completedAt: complete ? now : task.completedAt,
      updatedAt: now,
    })
    .where(eq(tasks.id, task.id));
  await syncTaskNotifications(
    {
      id: task.id,
      userId: task.userId,
      listId: task.listId,
      title: task.title,
      status,
      dueAt: task.dueAt,
      reminderMode: task.reminderMode,
      reminderOffsetMinutes: task.reminderOffsetMinutes,
      reminderAt: task.reminderAt,
      isAllDay: task.isAllDay,
      timezone: task.timezone,
      deletedAt: task.deletedAt,
      habitId: task.habitId,
      habitSeq: task.habitSeq,
      habitKey: task.habitKey,
      createdAt: task.createdAt,
    },
    user,
    now,
    tx,
  );
  await markAgentSchedule(tx, user.id, 'outcome.cluster', { now });
  if (complete) await enqueueTodayLayout(tx, user.id, now, 'complete');
  if (task.outcomeId) await enqueueOutcomeRefresh(tx, user.id, task.outcomeId, now);
}

export async function settleFailure(
  job: AgentJobRow,
  user: User,
  taskId: string,
  code: ErrandFailCode,
  now: Date,
  extra: { kind: ErrandKind; inboxItemId?: string; deeplink: string },
): Promise<void> {
  const marker = code === 'propose' ? proposeMarker(taskId) : failMarker(code, taskId);
  const block = FAIL_TEXT[code];
  await withAgentJobEffects(job, async (tx) => {
    const task = await lockTask(tx, user.id, taskId);
    if (!task || task.status === 'canceled') return;
    const notes = appendErrandNote(task.notesMd, marker, block);
    if (notes === null) return;
    const fresh = await freshUser(tx, user.id);
    if (!fresh) return;
    await tx.update(tasks).set({ notesMd: notes, updatedAt: now }).where(eq(tasks.id, task.id));
    await recordAgentAction(tx, {
      id: randomUUID(),
      userId: user.id,
      jobId: job.id,
      actionType:
        code === 'propose'
          ? 'errand.propose'
          : extra.kind === 'inbox.organize'
            ? 'errand.organize'
            : 'errand.summarize',
      targetType: 'task',
      targetId: task.id,
      payload: {
        ok: false,
        kind: extra.kind,
        reason: block,
        code,
        ...(extra.inboxItemId ? { inboxItemId: extra.inboxItemId } : {}),
      },
      feedback: code === 'propose' ? 'pending' : 'dismissed',
      createdAt: now,
    });
    await notifyRow(tx, fresh, task, now, {
      title: ERRAND_FAILED_TITLE,
      message: block,
      deeplink: extra.deeplink,
      key: `agent.errand:${fresh.id}:${task.id}:${extra.kind}:${code}`,
    });
  });
  skipExecution(
    code === 'no-model' ? 'NO_MODEL' : code === 'propose' ? 'CALL_LIMIT' : 'ERRAND_FAILED',
  );
}

export async function priorSummary(userId: string, inboxItemId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.userId, userId),
        eq(agentActions.actionType, 'errand.summarize'),
        eq(agentActions.feedback, 'accepted'),
        sql`${agentActions.payload}->>'inboxItemId' = ${inboxItemId}`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function reindex(
  taskId: string,
  userId: string,
  inboxIds: readonly string[],
): Promise<void> {
  const [task] = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);
  if (task) fireIndexTask(task);
  if (inboxIds.length === 0) return;
  const rows = await getDb()
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.userId, userId), inArray(inboxItems.id, [...inboxIds])));
  for (const row of rows) {
    void indexInboxItem(row).catch(() => undefined);
  }
}

export async function ensureTag(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  userId: string,
  name: string,
  now: Date,
): Promise<string | null> {
  const trimmed = name.trim().slice(0, 40);
  if (trimmed === '') return null;
  const [found] = await tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), sql`lower(${tags.name}) = ${trimmed.toLowerCase()}`))
    .limit(1);
  if (found) return found.id;
  const id = randomUUID();
  await tx.insert(tags).values({ id, userId, name: trimmed, color: null, createdAt: now });
  return id;
}

export async function modelText(
  user: User,
  systemPrompt: string,
  userPrompt: string,
  json: boolean,
): Promise<string | null> {
  const resolved = resolveModelFor(await loadLlmStore(user.id), 'agent.errand');
  if (!resolved) return null;
  const result = await completeText(user, 'agent.errand', {
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    ...(json ? { json: true } : {}),
  });
  return result?.text ?? null;
}
