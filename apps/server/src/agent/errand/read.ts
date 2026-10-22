import { randomUUID } from 'node:crypto';
import { articleDocToText, type ArticleDoc } from '@vital/article-doc';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from '../../errors.js';
import { getDb } from '../../db/index.js';
import {
  agentJobs,
  inboxItemBodies,
  inboxItems,
  tasks,
  type AgentJobRow,
  type TaskRow,
  type User,
} from '../../db/schema.js';
import { resolveModelFor } from '../../llm/pi.js';
import { loadLlmStore } from '../../llm/store.js';
import { getInboxList } from '../../lists/lists.service.js';
import { createTaskInTx } from '../../tasks/tasks.write.js';
import { fireIndexTask } from '../../tasks/tasks.shared.js';
import { recordAgentAction } from '../action-ledger.js';
import { executionResult, skipExecution } from '../executions.service.js';
import { enqueueAgentJob } from '../jobs.js';
import { LostAgentJobLeaseError, withAgentJobEffects } from '../job-runtime.js';
import { lockAgentUser } from '../user-lock.js';
import {
  finishTask,
  freshUser,
  lockTask,
  modelText,
  notifyRow,
  priorSummary,
  reindex,
  settleFailure,
} from './effects.js';
import {
  ERRAND_DONE_TITLE,
  ERRAND_JOB_TYPE,
  PROMPT_BODY_CHARS,
  appendErrandNote,
  errandReadMarker,
  errandSourceMarker,
  errandWouldExceed,
  isErrandPayload,
  isModelError,
  readDedupKey,
  threeLineSummary,
  type ErrandStart,
} from './model.js';
import { ownedInbox } from './store.js';

export async function enqueueRead(
  userId: string,
  inboxItemId: string,
  trigger: string,
  existingTaskId?: string,
): Promise<ErrandStart> {
  const item = await ownedInbox(userId, inboxItemId);
  if (!item) throw AppError.of(404, 'NOT_FOUND');
  const list = await getInboxList(userId);
  const dedupKey = readDedupKey(userId, inboxItemId);
  const indexed: { task: TaskRow | null } = { task: null };
  let taskId = '';
  let jobId: string | null = null;
  await getDb().transaction(async (tx) => {
    await lockAgentUser(tx, userId);
    const [job] = await tx
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.dedupKey, dedupKey))
      .limit(1);
    let reuse: string | null = existingTaskId ?? null;
    if (!reuse && job && job.userId === userId && isErrandPayload(job.payload))
      reuse = job.payload.taskId;
    if (reuse) {
      const [task] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, reuse), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
        .limit(1);
      if (task && task.status !== 'canceled') taskId = task.id;
    }
    if (taskId === '') {
      indexed.task = await createTaskInTx(tx, userId, {
        title: `读：${item.title}`.slice(0, 500),
        listId: list.id,
        notes: errandSourceMarker(item.id),
      });
      taskId = indexed.task.id;
    }
    jobId = await enqueueAgentJob(tx, {
      userId,
      jobType: ERRAND_JOB_TYPE,
      dedupKey,
      scheduledAt: new Date(),
      payload: {
        taskId,
        kind: 'inbox.read_summarize',
        inboxItemId: item.id,
        trigger,
      },
    });
  });
  if (indexed.task) fireIndexTask(indexed.task);
  return { taskId, jobId };
}

export async function startReadErrand(
  userId: string,
  inboxItemId: string,
  trigger = 'inbox',
): Promise<ErrandStart> {
  return enqueueRead(userId, inboxItemId, trigger);
}

export function bodyText(
  body: { contentJson: ArticleDoc | null; extractedText: string | null } | undefined,
): string {
  if (!body) return '';
  const fromDoc = body.contentJson ? articleDocToText(body.contentJson).trim() : '';
  if (fromDoc !== '') return fromDoc;
  return (body.extractedText ?? '').trim();
}

const READ_SYSTEM =
  '你是阅读助手。根据正文写恰好三行中文摘要，每行一句。不要标题，不要编号，不要 markdown。只依据正文，不要编造。';

export async function processRead(
  job: AgentJobRow,
  user: User,
  task: TaskRow,
  inboxItemId: string,
  now: Date,
): Promise<'done'> {
  const marker = errandReadMarker(inboxItemId);
  if (task.notesMd.includes(marker)) {
    skipExecution('ALREADY_APPLIED');
    return 'done';
  }
  const deeplink = `/inbox/${inboxItemId}`;
  if (await priorSummary(user.id, inboxItemId)) {
    await withAgentJobEffects(job, async (tx) => {
      const current = await lockTask(tx, user.id, task.id);
      if (!current || current.notesMd.includes(marker) || current.status === 'canceled') return;
      const notes = appendErrandNote(
        current.notesMd,
        marker,
        '代办 · 已读完\n摘要已经写在条目上。',
      );
      if (notes === null) return;
      const fresh = await freshUser(tx, user.id);
      if (!fresh) return;
      await finishTask(tx, fresh, current, notes, now);
      await recordAgentAction(tx, {
        id: randomUUID(),
        userId: user.id,
        jobId: job.id,
        actionType: 'errand.summarize',
        targetType: 'task',
        targetId: current.id,
        payload: { ok: true, kind: 'inbox.read_summarize', inboxItemId, summary: '', reused: true },
        feedback: 'accepted',
        createdAt: now,
      });
    });
    await reindex(task.id, user.id, []);
    executionResult({ resultSummary: '摘要已在，未重复写' });
    return 'done';
  }
  const item = await ownedInbox(user.id, inboxItemId);
  if (!item) {
    await settleFailure(job, user, task.id, 'missing-item', now, {
      kind: 'inbox.read_summarize',
      inboxItemId,
      deeplink,
    });
    return 'done';
  }
  const [body] = await getDb()
    .select()
    .from(inboxItemBodies)
    .where(eq(inboxItemBodies.inboxItemId, inboxItemId))
    .limit(1);
  const text = bodyText(body);
  if (text === '') {
    await settleFailure(job, user, task.id, 'no-body', now, {
      kind: 'inbox.read_summarize',
      inboxItemId,
      deeplink,
    });
    return 'done';
  }
  if (resolveModelFor(await loadLlmStore(user.id), 'agent.errand') === null) {
    await settleFailure(job, user, task.id, 'no-model', now, {
      kind: 'inbox.read_summarize',
      inboxItemId,
      deeplink,
    });
    return 'done';
  }
  if (errandWouldExceed(1)) {
    await settleFailure(job, user, task.id, 'propose', now, {
      kind: 'inbox.read_summarize',
      inboxItemId,
      deeplink,
    });
    return 'done';
  }
  let summary: string | null = null;
  try {
    const raw = await modelText(
      user,
      READ_SYSTEM,
      `标题：${item.title}\n正文：\n${text.slice(0, PROMPT_BODY_CHARS)}`,
      false,
    );
    summary = raw === null ? null : threeLineSummary(raw);
    if (raw === null) {
      await settleFailure(job, user, task.id, 'no-model', now, {
        kind: 'inbox.read_summarize',
        inboxItemId,
        deeplink,
      });
      return 'done';
    }
  } catch (err) {
    if (err instanceof LostAgentJobLeaseError) throw err;
    if (!isModelError(err)) throw err;
    await settleFailure(job, user, task.id, 'model-failed', now, {
      kind: 'inbox.read_summarize',
      inboxItemId,
      deeplink,
    });
    return 'done';
  }
  if (!summary) {
    await settleFailure(job, user, task.id, 'empty', now, {
      kind: 'inbox.read_summarize',
      inboxItemId,
      deeplink,
    });
    return 'done';
  }
  const written = summary;
  await withAgentJobEffects(job, async (tx) => {
    const current = await lockTask(tx, user.id, task.id);
    if (!current || current.status === 'canceled' || current.notesMd.includes(marker)) return;
    const [live] = await tx
      .select()
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.id, inboxItemId),
          eq(inboxItems.userId, user.id),
          isNull(inboxItems.deletedAt),
        ),
      )
      .for('update');
    if (!live) return;
    const notes = appendErrandNote(current.notesMd, marker, `代办 · 已读完\n${written}`);
    if (notes === null) return;
    const fresh = await freshUser(tx, user.id);
    if (!fresh) return;
    if (live.excerpt !== written) {
      await tx
        .update(inboxItems)
        .set({ excerpt: written, updatedAt: now })
        .where(eq(inboxItems.id, live.id));
    }
    await finishTask(tx, fresh, current, notes, now);
    await recordAgentAction(tx, {
      id: randomUUID(),
      userId: user.id,
      jobId: job.id,
      actionType: 'errand.summarize',
      targetType: 'task',
      targetId: current.id,
      payload: { ok: true, kind: 'inbox.read_summarize', inboxItemId, summary: written },
      feedback: 'accepted',
      createdAt: now,
    });
    await notifyRow(tx, fresh, current, now, {
      title: ERRAND_DONE_TITLE,
      message: written,
      deeplink,
      key: `agent.errand:${fresh.id}:${current.id}:inbox.read_summarize:done`,
    });
  });
  await reindex(task.id, user.id, [inboxItemId]);
  executionResult({ resultSummary: '已写入三行摘要' });
  return 'done';
}
