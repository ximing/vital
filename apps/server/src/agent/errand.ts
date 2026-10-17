import { createHash, randomUUID } from 'node:crypto';
import { articleDocToText, type ArticleDoc } from '@vital/article-doc';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../errors.js';
import { getDb } from '../db/index.js';
import {
  agentActions,
  agentJobs,
  entityLinks,
  inboxItemBodies,
  inboxItemTags,
  inboxItems,
  notificationOutbox,
  tags,
  taskCompletions,
  tasks,
  users,
  type AgentJobPayload,
  type AgentJobRow,
  type NotificationOutboxPayload,
  type TaskRow,
  type User,
} from '../db/schema.js';
import { completeText, resolveModelFor } from '../llm/pi.js';
import { loadLlmStore } from '../llm/store.js';
import { applyQuietHours } from '../notifications/quiet-hours.js';
import { syncTaskNotifications } from '../notifications/outbox.js';
import { indexInboxItem } from '../retrieval/search.js';
import { getInboxList } from '../lists/lists.service.js';
import { createTaskInTx } from '../tasks/tasks.write.js';
import { fireIndexTask } from '../tasks/tasks.shared.js';
import { recordAgentAction } from './action-ledger.js';
import { executionResult, skipExecution } from './executions.service.js';
import { enqueueAgentJob, enqueueOutcomeRefresh, enqueueTodayLayout } from './jobs.js';
import { DeferredAgentJobError, LostAgentJobLeaseError, withAgentJobEffects } from './job-runtime.js';
import { markAgentSchedule } from './scheduling.js';
import { lockAgentUser } from './user-lock.js';

/** Worker scan must not enqueue this. Chat, the inbox button, and draft upgrade do. */
export const ERRAND_JOB_TYPE = 'errand.run' as const;

export const ERRAND_MODEL_CALL_LIMIT = 3;
export const ORGANIZE_BATCH = 20;
const ORGANIZE_MAX_IDS = 80;
const PROMPT_BODY_CHARS = 8_000;
const EXCERPT_CHARS = 500;
const NOTE_CHARS = 50_000;
const NOTIFY_CHARS = 400;

export const ERRAND_DONE_TITLE = '代办完成';
export const ERRAND_FAILED_TITLE = '代办没完成';

export type ErrandKind = 'inbox.read_summarize' | 'inbox.organize';

const FAIL_TEXT = {
  'no-body': '代办没有完成：这篇没有正文，没法总结。',
  'no-model': '代办没有完成：没有可用的模型。',
  'model-failed': '代办没有完成：模型没有完成这次代办。',
  empty: '代办没有完成：模型没有给出摘要。',
  'missing-item': '代办没有完成：这篇收集箱条目不在了。',
  'no-items': '代办没有完成：没有可整理的收集箱条目。',
  'bad-plan': '代办没有完成：模型没有给出整理方案。',
  propose: '代办没有完成：模型调用会超过 3 次，已改成提案，需要你来处理。',
} as const;

export type ErrandFailCode = keyof typeof FAIL_TEXT;

/** Test seam: pretend this many model calls already happened in the errand. */
let callsAlreadyUsed = 0;

export function setErrandCallsAlreadyUsed(n: number): void {
  callsAlreadyUsed = n;
}

export function resetErrandForTests(): void {
  callsAlreadyUsed = 0;
}

export function organizeModelCalls(itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.ceil(itemCount / ORGANIZE_BATCH);
}

export function errandWouldExceed(needed: number, alreadyUsed = callsAlreadyUsed): boolean {
  return alreadyUsed + needed > ERRAND_MODEL_CALL_LIMIT;
}

export function readDedupKey(userId: string, inboxItemId: string): string {
  return `errand.run:read:${userId}:${inboxItemId}`;
}

export function organizeDedupKey(userId: string, ids: readonly string[]): string {
  const hash = createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 32);
  return `errand.run:organize:${userId}:${hash}`;
}

export function errandSourceMarker(inboxItemId: string): string {
  return `<!-- errand-source:inbox:${inboxItemId} -->`;
}

export function errandReadMarker(inboxItemId: string): string {
  return `<!-- errand:read:${inboxItemId} -->`;
}

export function errandOrganizeMarker(taskId: string): string {
  return `<!-- errand:organize:${taskId} -->`;
}

function failMarker(code: ErrandFailCode, taskId: string): string {
  return `<!-- errand:fail:${code}:${taskId} -->`;
}

function proposeMarker(taskId: string): string {
  return `<!-- errand:propose:${taskId} -->`;
}

export function appendErrandNote(notes: string, marker: string, block: string): string | null {
  if (notes.includes(marker)) return null;
  const base = notes.trimEnd();
  const next = `${base}${base === '' ? '' : '\n\n'}${marker}\n${block}`;
  return next.slice(0, NOTE_CHARS);
}

/** Exactly three lines when the model cooperates. Never invents a line. */
export function threeLineSummary(raw: string): string | null {
  const cleaned = raw.replace(/```[\s\S]*?```/g, ' ').trim();
  let lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  lines = lines
    .map((line) => line.replace(/^[#>*\-\d.、\s]+/, '').trim())
    .filter((line) => line !== '');
  if (lines.length === 1) {
    const parts = lines[0]!.split(/(?<=[。！？])/).map((part) => part.trim()).filter((part) => part !== '');
    if (parts.length > 1) lines = parts;
  }
  if (lines.length === 0) return null;
  const summary = lines.slice(0, 3).join('\n');
  return summary.length <= EXCERPT_CHARS ? summary : summary.slice(0, EXCERPT_CHARS);
}

export interface OrganizePlanItem {
  id: string;
  archive: boolean;
  addTags: string[];
}

export interface OrganizePlan {
  note: string;
  items: OrganizePlanItem[];
}

export function parseOrganizePlan(raw: string, allowed: ReadonlySet<string>): OrganizePlan | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let body: unknown;
  try {
    body = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const note = typeof record['note'] === 'string' ? record['note'].trim().slice(0, 2000) : '';
  const rows = Array.isArray(record['items']) ? record['items'] : [];
  const items: OrganizePlanItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const id = typeof item['id'] === 'string' ? item['id'] : '';
    if (!allowed.has(id)) continue;
    const addTags = Array.isArray(item['addTags'])
      ? item['addTags']
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim().slice(0, 40))
          .filter((tag) => tag !== '')
          .slice(0, 8)
      : [];
    items.push({ id, archive: item['archive'] === true, addTags });
  }
  if (note === '' && items.length === 0) return null;
  return { note, items };
}

type ErrandPayload = AgentJobPayload & {
  taskId: string;
  kind: ErrandKind;
  inboxItemId?: string;
  inboxItemIds?: string[];
};

export function isErrandPayload(payload: AgentJobPayload): payload is ErrandPayload {
  if (!('taskId' in payload) || typeof payload.taskId !== 'string') return false;
  if (!('kind' in payload)) return false;
  return payload.kind === 'inbox.read_summarize' || payload.kind === 'inbox.organize';
}

export interface ErrandStart {
  taskId: string;
  jobId: string | null;
}

function isModelError(err: unknown): boolean {
  if (err instanceof DeferredAgentJobError) return true;
  return err instanceof AppError && err.code.startsWith('LLM_');
}

function clipNotify(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= NOTIFY_CHARS ? trimmed : `${trimmed.slice(0, NOTIFY_CHARS - 1)}…`;
}

async function ownedInbox(userId: string, inboxItemId: string) {
  const [row] = await getDb()
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.id, inboxItemId), eq(inboxItems.userId, userId), isNull(inboxItems.deletedAt)))
    .limit(1);
  return row ?? null;
}

async function liveInboxIds(userId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const unique = [...new Set(ids)].slice(0, ORGANIZE_MAX_IDS);
  const rows = await getDb()
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(and(eq(inboxItems.userId, userId), inArray(inboxItems.id, unique), isNull(inboxItems.deletedAt)));
  const live = new Set(rows.map((row) => row.id));
  return unique.filter((id) => live.has(id));
}

async function taskById(userId: string, taskId: string): Promise<TaskRow | null> {
  const [row] = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);
  return row ?? null;
}

async function enqueueRead(
  userId: string,
  inboxItemId: string,
  trigger: string,
  existingTaskId?: string,
): Promise<ErrandStart> {
  const item = await ownedInbox(userId, inboxItemId);
  if (!item) throw AppError.of(404, 'NOT_FOUND');
  const list = await getInboxList(userId);
  const dedupKey = readDedupKey(userId, inboxItemId);
  let created: TaskRow | null = null;
  let taskId = '';
  let jobId: string | null = null;
  await getDb().transaction(async (tx) => {
    await lockAgentUser(tx, userId);
    const [job] = await tx.select().from(agentJobs).where(eq(agentJobs.dedupKey, dedupKey)).limit(1);
    let reuse: string | null = existingTaskId ?? null;
    if (!reuse && job && job.userId === userId && isErrandPayload(job.payload)) reuse = job.payload.taskId;
    if (reuse) {
      const [task] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, reuse), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
        .limit(1);
      if (task && task.status !== 'canceled') taskId = task.id;
    }
    if (taskId === '') {
      created = await createTaskInTx(tx, userId, {
        title: `读：${item.title}`.slice(0, 500),
        listId: list.id,
        notes: errandSourceMarker(item.id),
      });
      taskId = created.id;
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
  if (created) fireIndexTask(created);
  return { taskId, jobId };
}

async function enqueueOrganize(userId: string, ids: readonly string[], trigger: string, existingTaskId?: string): Promise<ErrandStart> {
  const live = await liveInboxIds(userId, ids);
  if (live.length === 0) throw AppError.of(404, 'NOT_FOUND');
  const list = await getInboxList(userId);
  const dedupKey = organizeDedupKey(userId, live);
  let created: TaskRow | null = null;
  let taskId = '';
  let jobId: string | null = null;
  await getDb().transaction(async (tx) => {
    await lockAgentUser(tx, userId);
    const [job] = await tx.select().from(agentJobs).where(eq(agentJobs.dedupKey, dedupKey)).limit(1);
    let reuse: string | null = existingTaskId ?? null;
    if (!reuse && job && job.userId === userId && isErrandPayload(job.payload)) reuse = job.payload.taskId;
    if (reuse) {
      const [task] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, reuse), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
        .limit(1);
      if (task && task.status !== 'canceled') taskId = task.id;
    }
    if (taskId === '') {
      created = await createTaskInTx(tx, userId, {
        title: '整理收集箱',
        listId: list.id,
        notes: live.map((id) => errandSourceMarker(id)).join('\n'),
      });
      taskId = created.id;
    }
    jobId = await enqueueAgentJob(tx, {
      userId,
      jobType: ERRAND_JOB_TYPE,
      dedupKey,
      scheduledAt: new Date(),
      payload: {
        taskId,
        kind: 'inbox.organize',
        inboxItemIds: live,
        trigger,
      },
    });
  });
  if (created) fireIndexTask(created);
  return { taskId, jobId };
}

export async function startReadErrand(userId: string, inboxItemId: string, trigger = 'inbox'): Promise<ErrandStart> {
  return enqueueRead(userId, inboxItemId, trigger);
}

export async function startOrganizeErrand(userId: string, inboxItemIds: readonly string[], trigger = 'chat'): Promise<ErrandStart> {
  return enqueueOrganize(userId, inboxItemIds, trigger);
}

async function linkedInboxIds(userId: string, task: TaskRow): Promise<string[]> {
  const ids = new Set<string>();
  for (const match of task.notesMd.matchAll(/<!-- errand-source:inbox:([0-9a-fA-F-]{36}) -->/g)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  const converted = await getDb()
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(and(eq(inboxItems.userId, userId), eq(inboxItems.convertedTaskId, task.id), isNull(inboxItems.deletedAt)));
  for (const row of converted) ids.add(row.id);
  const links = await getDb()
    .select({ toId: entityLinks.toId })
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, userId),
        eq(entityLinks.fromType, 'task'),
        eq(entityLinks.fromId, task.id),
        eq(entityLinks.toType, 'inbox'),
      ),
    );
  for (const row of links) ids.add(row.toId);
  return liveInboxIds(userId, [...ids]);
}

export async function upgradeTaskErrand(
  userId: string,
  taskId: string,
  input: { kind?: ErrandKind; inboxItemId?: string; inboxItemIds?: string[] } = {},
): Promise<ErrandStart> {
  const task = await taskById(userId, taskId);
  if (!task || task.deletedAt) throw AppError.of(404, 'NOT_FOUND');
  if (task.status === 'done' || task.status === 'canceled') {
    throw new AppError(400, 'VALIDATION_ERROR', '这个任务已经结束，不能再代办。');
  }
  if (!task.delegable) {
    throw new AppError(400, 'VALIDATION_ERROR', '先打开「可交给 Agent」，才能改为代办。');
  }
  if (input.kind === 'inbox.organize') {
    const ids = input.inboxItemIds ?? (await linkedInboxIds(userId, task));
    if (ids.length === 0) throw new AppError(400, 'VALIDATION_ERROR', '这个任务没有连着收集箱，还不能代办。');
    return enqueueOrganize(userId, ids, 'task.draft', task.id);
  }
  if (input.kind === 'inbox.read_summarize' || input.inboxItemId) {
    const inboxItemId = input.inboxItemId ?? (await linkedInboxIds(userId, task))[0];
    if (!inboxItemId) throw new AppError(400, 'VALIDATION_ERROR', '这个任务没有连着收集箱，还不能代办。');
    return enqueueRead(userId, inboxItemId, 'task.draft', task.id);
  }
  const linked = await linkedInboxIds(userId, task);
  if (linked.length === 1) return enqueueRead(userId, linked[0]!, 'task.draft', task.id);
  if (linked.length > 1) return enqueueOrganize(userId, linked, 'task.draft', task.id);
  throw new AppError(400, 'VALIDATION_ERROR', '这个任务没有连着收集箱，还不能代办。');
}

function bodyText(body: { contentJson: ArticleDoc | null; extractedText: string | null } | undefined): string {
  if (!body) return '';
  const fromDoc = body.contentJson ? articleDocToText(body.contentJson).trim() : '';
  if (fromDoc !== '') return fromDoc;
  return (body.extractedText ?? '').trim();
}

async function notifyRow(
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

async function freshUser(tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0], userId: string): Promise<User | null> {
  const [row] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}

async function lockTask(
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

async function finishTask(
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

async function settleFailure(
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
      actionType: code === 'propose' ? 'errand.propose' : extra.kind === 'inbox.organize' ? 'errand.organize' : 'errand.summarize',
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
  skipExecution(code === 'no-model' ? 'NO_MODEL' : code === 'propose' ? 'CALL_LIMIT' : 'ERRAND_FAILED');
}

async function priorSummary(userId: string, inboxItemId: string): Promise<boolean> {
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

async function reindex(taskId: string, userId: string, inboxIds: readonly string[]): Promise<void> {
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

async function ensureTag(
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

async function modelText(user: User, systemPrompt: string, userPrompt: string, json: boolean): Promise<string | null> {
  const resolved = resolveModelFor(await loadLlmStore(user.id), 'agent.errand');
  if (!resolved) return null;
  const result = await completeText(user, 'agent.errand', {
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    ...(json ? { json: true } : {}),
  });
  return result?.text ?? null;
}

const READ_SYSTEM = '你是阅读助手。根据正文写恰好三行中文摘要，每行一句。不要标题，不要编号，不要 markdown。只依据正文，不要编造。';
const ORGANIZE_SYSTEM = '你整理收集箱。只输出 JSON：{"note":"一句整理说明","items":[{"id":"...","archive":true,"addTags":["标签"]}]}。只能使用给出的 id。archive 为 true 表示归档。addTags 是要新增的标签名，不要删除已有标签。不要编造 id。';

async function processRead(job: AgentJobRow, user: User, task: TaskRow, inboxItemId: string, now: Date): Promise<'done'> {
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
      const notes = appendErrandNote(current.notesMd, marker, '代办 · 已读完\n摘要已经写在条目上。');
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
    await settleFailure(job, user, task.id, 'missing-item', now, { kind: 'inbox.read_summarize', inboxItemId, deeplink });
    return 'done';
  }
  const [body] = await getDb()
    .select()
    .from(inboxItemBodies)
    .where(eq(inboxItemBodies.inboxItemId, inboxItemId))
    .limit(1);
  const text = bodyText(body);
  if (text === '') {
    await settleFailure(job, user, task.id, 'no-body', now, { kind: 'inbox.read_summarize', inboxItemId, deeplink });
    return 'done';
  }
  if (resolveModelFor(await loadLlmStore(user.id), 'agent.errand') === null) {
    await settleFailure(job, user, task.id, 'no-model', now, { kind: 'inbox.read_summarize', inboxItemId, deeplink });
    return 'done';
  }
  if (errandWouldExceed(1)) {
    await settleFailure(job, user, task.id, 'propose', now, { kind: 'inbox.read_summarize', inboxItemId, deeplink });
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
      await settleFailure(job, user, task.id, 'no-model', now, { kind: 'inbox.read_summarize', inboxItemId, deeplink });
      return 'done';
    }
  } catch (err) {
    if (err instanceof LostAgentJobLeaseError) throw err;
    if (!isModelError(err)) throw err;
    await settleFailure(job, user, task.id, 'model-failed', now, { kind: 'inbox.read_summarize', inboxItemId, deeplink });
    return 'done';
  }
  if (!summary) {
    await settleFailure(job, user, task.id, 'empty', now, { kind: 'inbox.read_summarize', inboxItemId, deeplink });
    return 'done';
  }
  const written = summary;
  await withAgentJobEffects(job, async (tx) => {
    const current = await lockTask(tx, user.id, task.id);
    if (!current || current.status === 'canceled' || current.notesMd.includes(marker)) return;
    const [live] = await tx
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.id, inboxItemId), eq(inboxItems.userId, user.id), isNull(inboxItems.deletedAt)))
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

interface OrganizeRow {
  id: string;
  title: string;
  excerpt: string | null;
  status: string;
  tags: string[];
}

async function loadOrganizeRows(userId: string, ids: readonly string[]): Promise<OrganizeRow[]> {
  const live = await liveInboxIds(userId, ids);
  if (live.length === 0) return [];
  const items = await getDb()
    .select({
      id: inboxItems.id,
      title: inboxItems.title,
      excerpt: inboxItems.excerpt,
      status: inboxItems.status,
    })
    .from(inboxItems)
    .where(and(eq(inboxItems.userId, userId), inArray(inboxItems.id, live), isNull(inboxItems.deletedAt)));
  const links = await getDb()
    .select({ inboxItemId: inboxItemTags.inboxItemId, name: tags.name })
    .from(inboxItemTags)
    .innerJoin(tags, eq(tags.id, inboxItemTags.tagId))
    .where(inArray(inboxItemTags.inboxItemId, live));
  const byItem = new Map<string, string[]>();
  for (const link of links) {
    const list = byItem.get(link.inboxItemId) ?? [];
    list.push(link.name);
    byItem.set(link.inboxItemId, list);
  }
  const order = new Map(live.map((id, index) => [id, index]));
  return items
    .map((item) => ({ ...item, tags: byItem.get(item.id) ?? [] }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function organizePrompt(rows: readonly OrganizeRow[]): string {
  const lines = rows.map((row) => {
    const excerpt = (row.excerpt ?? '').replace(/\s+/g, ' ').slice(0, 80);
    const tag = row.tags.length > 0 ? row.tags.join('、') : '无';
    return `- id=${row.id} status=${row.status} tags=${tag} title=${row.title}${excerpt === '' ? '' : ` excerpt=${excerpt}`}`;
  });
  return lines.join('\n');
}

async function processOrganize(
  job: AgentJobRow,
  user: User,
  task: TaskRow,
  ids: readonly string[],
  now: Date,
): Promise<'done'> {
  const marker = errandOrganizeMarker(task.id);
  const deeplink = '/inbox';
  if (task.notesMd.includes(marker)) {
    skipExecution('ALREADY_APPLIED');
    return 'done';
  }
  const rows = await loadOrganizeRows(user.id, ids);
  if (rows.length === 0) {
    await settleFailure(job, user, task.id, 'no-items', now, { kind: 'inbox.organize', deeplink });
    return 'done';
  }
  const needed = organizeModelCalls(rows.length);
  if (resolveModelFor(await loadLlmStore(user.id), 'agent.errand') === null) {
    await settleFailure(job, user, task.id, 'no-model', now, { kind: 'inbox.organize', deeplink });
    return 'done';
  }
  if (errandWouldExceed(needed)) {
    await settleFailure(job, user, task.id, 'propose', now, { kind: 'inbox.organize', deeplink });
    return 'done';
  }
  const plans: OrganizePlan[] = [];
  try {
    for (let offset = 0; offset < rows.length; offset += ORGANIZE_BATCH) {
      const batch = rows.slice(offset, offset + ORGANIZE_BATCH);
      const allowed = new Set(batch.map((row) => row.id));
      const raw = await modelText(user, ORGANIZE_SYSTEM, organizePrompt(batch), true);
      if (raw === null) {
        await settleFailure(job, user, task.id, 'no-model', now, { kind: 'inbox.organize', deeplink });
        return 'done';
      }
      const plan = parseOrganizePlan(raw, allowed);
      if (!plan) {
        await settleFailure(job, user, task.id, 'bad-plan', now, { kind: 'inbox.organize', deeplink });
        return 'done';
      }
      plans.push(plan);
    }
  } catch (err) {
    if (err instanceof LostAgentJobLeaseError) throw err;
    if (!isModelError(err)) throw err;
    await settleFailure(job, user, task.id, 'model-failed', now, { kind: 'inbox.organize', deeplink });
    return 'done';
  }
  const note = plans
    .map((plan) => plan.note)
    .filter((line) => line !== '')
    .join('\n')
    .slice(0, 2000);
  const actions = plans.flatMap((plan) => plan.items);
  const explanation = note !== '' ? note : '已按条目归档或打上标签。';
  await withAgentJobEffects(job, async (tx) => {
    const current = await lockTask(tx, user.id, task.id);
    if (!current || current.status === 'canceled' || current.notesMd.includes(marker)) return;
    const notes = appendErrandNote(current.notesMd, marker, `代办 · 已整理\n${explanation}`);
    if (notes === null) return;
    const fresh = await freshUser(tx, user.id);
    if (!fresh) return;
    const tagCache = new Map<string, string>();
    for (const action of actions) {
      if (action.archive) {
        await tx
          .update(inboxItems)
          .set({ status: 'archived', updatedAt: now })
          .where(
            and(
              eq(inboxItems.id, action.id),
              eq(inboxItems.userId, user.id),
              isNull(inboxItems.deletedAt),
              inArray(inboxItems.status, ['unread', 'later']),
            ),
          );
      }
      if (action.addTags.length === 0) continue;
      const tagIds: string[] = [];
      for (const name of action.addTags) {
        const key = name.toLowerCase();
        let id = tagCache.get(key);
        if (!id) {
          const created = await ensureTag(tx, user.id, name, now);
          if (!created) continue;
          id = created;
          tagCache.set(key, id);
        }
        tagIds.push(id);
      }
      if (tagIds.length === 0) continue;
      const existing = await tx
        .select({ tagId: inboxItemTags.tagId })
        .from(inboxItemTags)
        .where(eq(inboxItemTags.inboxItemId, action.id));
      const have = new Set(existing.map((row) => row.tagId));
      const missing = tagIds.filter((id) => !have.has(id));
      if (missing.length > 0) {
        await tx.insert(inboxItemTags).values(missing.map((tagId) => ({ inboxItemId: action.id, tagId })));
      }
    }
    await finishTask(tx, fresh, current, notes, now);
    await recordAgentAction(tx, {
      id: randomUUID(),
      userId: user.id,
      jobId: job.id,
      actionType: 'errand.organize',
      targetType: 'task',
      targetId: current.id,
      payload: {
        ok: true,
        kind: 'inbox.organize',
        inboxItemIds: rows.map((row) => row.id),
        note: explanation,
      },
      feedback: 'accepted',
      createdAt: now,
    });
    await notifyRow(tx, fresh, current, now, {
      title: ERRAND_DONE_TITLE,
      message: explanation,
      deeplink,
      key: `agent.errand:${fresh.id}:${current.id}:inbox.organize:done`,
    });
  });
  await reindex(task.id, user.id, rows.map((row) => row.id));
  executionResult({ resultSummary: `已整理 ${String(rows.length)} 篇` });
  return 'done';
}

export async function processErrand(job: AgentJobRow, user: User, now: Date): Promise<'done'> {
  if (!isErrandPayload(job.payload)) {
    skipExecution('INVALID_PAYLOAD');
    return 'done';
  }
  const task = await taskById(user.id, job.payload.taskId);
  if (!task || task.deletedAt) {
    skipExecution('TASK_NOT_FOUND');
    return 'done';
  }
  if (task.status === 'canceled') {
    skipExecution('TASK_CLOSED');
    return 'done';
  }
  executionResult({
    targetType: 'task',
    targetId: task.id,
    inputSummary: job.payload.kind === 'inbox.read_summarize' ? '读一篇收集箱' : '整理收集箱',
  });
  if (job.payload.kind === 'inbox.read_summarize') {
    const inboxItemId = job.payload.inboxItemId;
    if (!inboxItemId) {
      skipExecution('INVALID_PAYLOAD');
      return 'done';
    }
    return processRead(job, user, task, inboxItemId, now);
  }
  const ids = job.payload.inboxItemIds ?? [];
  if (ids.length === 0) {
    skipExecution('INVALID_PAYLOAD');
    return 'done';
  }
  return processOrganize(job, user, task, ids, now);
}
