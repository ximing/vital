import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { DeferredAgentJobError } from '../agent/job-runtime.js';
import { loadAgentMemory, runProposalPass } from '../agent/harness.js';
import { reserveBackgroundModelCall } from '../agent/model-budget.js';
import { submitNotificationTool, type SubmitNotificationArgs } from '../agent/tools.js';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import {
  inboxItems,
  notificationOutbox,
  tasks,
  users,
  type NotificationOutboxPayload,
  type NotificationOutboxRow,
  type User,
} from '../db/schema.js';
import { resolveModelFor } from '../llm/pi.js';
import { loadLlmStore } from '../llm/store.js';
import { searchAll } from '../retrieval/search.js';
import { searchSimilarTasks } from '../retrieval/tasks.js';
import { logger } from '../utils/logger.js';
import { applyQuietHours } from './quiet-hours.js';

/** How long before the meeting the card should fire. */
export const MEETING_PREP_LEAD_MS = 15 * 60 * 1000;

/** Rerank scores below this are not "related". Same bar as duplicate detection. */
export const MEETING_PREP_SIMILAR_MIN_SCORE = 0.4;

export const MEETING_PREP_TITLE = '会前准备';

/** In-app click target. Stays on the page origin; MeoW prefixes WEB_ORIGIN. */
export const MEETING_PREP_PATH = '/today#meetings';

const TASK_SCAN_LIMIT = 400;
const INBOX_SCAN_LIMIT = 80;
const INBOX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TASK_HIT_LIMIT = 5;
const INBOX_HIT_LIMIT = 3;
const SIMILAR_LIMIT = 8;
const OPEN = ['todo', 'doing'] as const;

/**
 * Pairs that show up in almost every title. Sharing only these is not a match.
 * CJK has no segmenter here, so tokens are bigrams plus Latin words.
 */
const STOP_TOKENS = new Set([
  '今天',
  '明天',
  '后天',
  '上午',
  '下午',
  '晚上',
  '早上',
  '中午',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
  '周日',
  '周末',
  '一个',
  '我们',
  '这个',
  '那个',
]);

const SYSTEM_PROMPT = `你把会前准备改写成一条中文手机通知，80 字以内。只使用规则底稿里的会议名和相关条目，不编造任务或笔记。
不要标题，不要列表。必须调用 submit_notification。`;

export type MeetingPrepCandidate = {
  id: string;
  kind: 'task' | 'inbox';
  title: string;
  outcomeId: string | null;
  open: boolean;
  /** Embedding / rerank recall. Title words are not required when this is set. */
  similar: boolean;
};

type SimilarHit = { id: string; title: string };

type SimilarLookup = (userId: string, query: string, excludeId: string) => Promise<SimilarHit[]>;

type MeetingRewrite = (user: User, rule: string) => Promise<string | null>;

let similarOverride: SimilarLookup | null = null;
let rewriteOverride: MeetingRewrite | null = null;

/** Test seam. Production calls searchSimilarTasks and swallows infra errors. */
export function setMeetingPrepSimilar(next: SimilarLookup | null): void {
  similarOverride = next;
}

/** Test seam. Production leaves this null and calls agent.notify. */
export function setMeetingPrepRewrite(next: MeetingRewrite | null): void {
  rewriteOverride = next;
}

export function meetingPrepKey(taskId: string, startAt: Date): string {
  return `meeting.prep:${taskId}:${startAt.toISOString()}`;
}

export function titleTokens(value: string): string[] {
  const tokens: string[] = [];
  const latin = value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  for (const token of latin) {
    if (!STOP_TOKENS.has(token)) tokens.push(token);
  }
  const runs = value.match(/[\u3400-\u9fff]{2,}/g) ?? [];
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i += 1) {
      const gram = run.slice(i, i + 2);
      if (!STOP_TOKENS.has(gram)) tokens.push(gram);
    }
  }
  return tokens;
}

export function sharesTitleWord(left: string, right: string): boolean {
  const words = new Set(titleTokens(left));
  if (words.size === 0) return false;
  for (const token of titleTokens(right)) {
    if (words.has(token)) return true;
  }
  return false;
}

function rankOf(
  meeting: { id: string; title: string; outcomeId: string | null },
  candidate: MeetingPrepCandidate,
): number | null {
  if (candidate.kind === 'task' && (candidate.id === meeting.id || !candidate.open)) return null;
  if (candidate.title.trim() === '') return null;
  const word = sharesTitleWord(meeting.title, candidate.title);
  const sameOutcome =
    candidate.kind === 'task' &&
    meeting.outcomeId !== null &&
    candidate.outcomeId !== null &&
    candidate.outcomeId === meeting.outcomeId;
  if (candidate.similar && word) return 0;
  if (candidate.similar) return 1;
  if (word) return 2;
  if (sameOutcome) return 3;
  return null;
}

/** Open tasks and recent notes related to a meeting. Empty means do not push. */
export function selectMeetingPrep(
  meeting: { id: string; title: string; outcomeId: string | null },
  candidates: readonly MeetingPrepCandidate[],
): { tasks: MeetingPrepCandidate[]; inbox: MeetingPrepCandidate[] } {
  const ranked: { item: MeetingPrepCandidate; rank: number }[] = [];
  for (const candidate of candidates) {
    const rank = rankOf(meeting, candidate);
    if (rank === null) continue;
    ranked.push({ item: candidate, rank });
  }
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.item.title.localeCompare(b.item.title, 'zh') ||
      a.item.id.localeCompare(b.item.id),
  );
  const tasks: MeetingPrepCandidate[] = [];
  const inbox: MeetingPrepCandidate[] = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    const key = `${row.item.kind}:${row.item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (row.item.kind === 'task') {
      if (tasks.length >= TASK_HIT_LIMIT) continue;
      tasks.push(row.item);
    } else if (inbox.length < INBOX_HIT_LIMIT) {
      inbox.push(row.item);
    }
  }
  return { tasks, inbox };
}

/** Rule copy. Callers skip the send when both lists are empty. */
export function meetingPrepMessage(
  meetingTitle: string,
  taskTitles: readonly string[],
  inboxTitles: readonly string[],
): string {
  const parts = [`「${meetingTitle}」约 15 分钟后开始`];
  if (taskTitles.length > 0) parts.push(`相关任务：${taskTitles.join('、')}`);
  if (inboxTitles.length > 0) parts.push(`相关笔记：${inboxTitles.join('、')}`);
  return `${parts.join('。')}。`;
}

/** Keep a rewrite only when it still names the meeting and every related title. */
export function acceptMeetingPrepText(
  text: string,
  meetingTitle: string,
  relatedTitles: readonly string[],
  rule: string,
): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed === '' || trimmed.length > 200) return rule;
  if (meetingTitle !== '' && !trimmed.includes(meetingTitle)) return rule;
  if (relatedTitles.some((title) => title !== '' && !trimmed.includes(title))) return rule;
  return trimmed;
}

/**
 * Fire time for one meeting, or null when it is outside the scan window,
 * already started, or quiet hours would land at or after the start.
 * `lookaheadMs` should cover the lead plus one poll, so the next tick cannot skip it.
 */
export function meetingPrepFire(
  now: Date,
  startAt: Date,
  quietStart: string | null,
  quietEnd: string | null,
  timeZone: string,
  lookaheadMs: number,
): Date | null {
  const startMs = startAt.getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return null;
  if (startMs <= nowMs || startMs > nowMs + lookaheadMs) return null;
  if (!DateTime.fromJSDate(now, { zone: timeZone }).isValid) return null;
  const lead = new Date(startMs - MEETING_PREP_LEAD_MS);
  const instant = lead.getTime() > nowMs ? lead : now;
  const scheduled = applyQuietHours(instant, quietStart, quietEnd, timeZone);
  if (scheduled.getTime() >= startMs) return null;
  return scheduled;
}

function claimed(id: string) {
  return and(eq(notificationOutbox.id, id), eq(notificationOutbox.status, 'sending'));
}

async function cancel(id: string, now: Date, lastError: string): Promise<void> {
  await getDb()
    .update(notificationOutbox)
    .set({ status: 'cancelled', updatedAt: now, lastError })
    .where(claimed(id));
}

async function savePayload(
  job: NotificationOutboxRow,
  payload: NotificationOutboxPayload,
  now: Date,
): Promise<boolean> {
  const updated = await getDb()
    .update(notificationOutbox)
    .set({ payload, updatedAt: now })
    .where(claimed(job.id))
    .returning({ id: notificationOutbox.id });
  if (updated.length === 0) return false;
  job.payload = payload;
  return true;
}

function addCandidate(map: Map<string, MeetingPrepCandidate>, candidate: MeetingPrepCandidate): void {
  const key = `${candidate.kind}:${candidate.id}`;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, candidate);
    return;
  }
  if (candidate.similar) prev.similar = true;
}

async function similarTasks(userId: string, query: string, excludeId: string): Promise<SimilarHit[]> {
  try {
    if (similarOverride) return await similarOverride(userId, query, excludeId);
    const found = await searchSimilarTasks({
      userId,
      query,
      excludeId,
      status: OPEN,
      limit: SIMILAR_LIMIT,
      minScore: MEETING_PREP_SIMILAR_MIN_SCORE,
    });
    return found ?? [];
  } catch (err) {
    logger.info('meeting prep retrieval fallback', {
      userId,
      reason: err instanceof Error ? err.message : 'error',
    });
    return [];
  }
}

async function inboxTextHits(userId: string, query: string): Promise<SimilarHit[]> {
  try {
    const found = await searchAll({ userId, q: query, limit: SIMILAR_LIMIT });
    return found?.inbox.map((hit) => ({ id: hit.id, title: hit.title })) ?? [];
  } catch (err) {
    logger.info('meeting prep inbox retrieval fallback', {
      userId,
      reason: err instanceof Error ? err.message : 'error',
    });
    return [];
  }
}

async function loadMeetingPrepHits(
  userId: string,
  meeting: { id: string; title: string; outcomeId: string | null },
  now: Date,
): Promise<{ tasks: MeetingPrepCandidate[]; inbox: MeetingPrepCandidate[] }> {
  const since = new Date(now.getTime() - INBOX_WINDOW_MS);
  const [taskRows, inboxRows] = await Promise.all([
    getDb()
      .select({ id: tasks.id, title: tasks.title, outcomeId: tasks.outcomeId })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
          isNull(tasks.habitId),
          ne(tasks.id, meeting.id),
          inArray(tasks.status, [...OPEN]),
        ),
      )
      .orderBy(desc(tasks.updatedAt), desc(tasks.id))
      .limit(TASK_SCAN_LIMIT),
    getDb()
      .select({ id: inboxItems.id, title: inboxItems.title, outcomeId: inboxItems.outcomeId })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, userId),
          isNull(inboxItems.deletedAt),
          inArray(inboxItems.status, ['unread', 'later']),
          gte(inboxItems.updatedAt, since),
        ),
      )
      .orderBy(desc(inboxItems.updatedAt), desc(inboxItems.id))
      .limit(INBOX_SCAN_LIMIT),
  ]);

  const map = new Map<string, MeetingPrepCandidate>();
  for (const row of taskRows) {
    addCandidate(map, {
      id: row.id,
      kind: 'task',
      title: row.title,
      outcomeId: row.outcomeId,
      open: true,
      similar: false,
    });
  }
  for (const row of inboxRows) {
    addCandidate(map, {
      id: row.id,
      kind: 'inbox',
      title: row.title,
      outcomeId: row.outcomeId,
      open: true,
      similar: false,
    });
  }

  const similar = await similarTasks(userId, meeting.title, meeting.id);
  const missingTasks = similar.flatMap((hit) => (hit.id !== meeting.id && !map.has(`task:${hit.id}`) ? [hit.id] : []));
  for (const hit of similar) {
    const row = map.get(`task:${hit.id}`);
    if (row) row.similar = true;
  }
  if (missingTasks.length > 0) {
    const extra = await getDb()
      .select({ id: tasks.id, title: tasks.title, outcomeId: tasks.outcomeId })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          inArray(tasks.id, missingTasks),
          isNull(tasks.deletedAt),
          isNull(tasks.habitId),
          inArray(tasks.status, [...OPEN]),
        ),
      );
    for (const row of extra) {
      addCandidate(map, {
        id: row.id,
        kind: 'task',
        title: row.title,
        outcomeId: row.outcomeId,
        open: true,
        similar: true,
      });
    }
  }

  const textInbox = await inboxTextHits(userId, meeting.title);
  const missingInbox = textInbox.flatMap((hit) => (map.has(`inbox:${hit.id}`) ? [] : [hit.id]));
  if (missingInbox.length > 0) {
    const extra = await getDb()
      .select({ id: inboxItems.id, title: inboxItems.title, outcomeId: inboxItems.outcomeId })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, userId),
          inArray(inboxItems.id, missingInbox),
          isNull(inboxItems.deletedAt),
          inArray(inboxItems.status, ['unread', 'later']),
        ),
      );
    for (const row of extra) {
      addCandidate(map, {
        id: row.id,
        kind: 'inbox',
        title: row.title,
        outcomeId: row.outcomeId,
        open: true,
        similar: false,
      });
    }
  }

  return selectMeetingPrep(meeting, [...map.values()]);
}

async function modelReady(userId: string): Promise<boolean> {
  if (rewriteOverride) return true;
  return resolveModelFor(await loadLlmStore(userId), 'agent.notify') !== null;
}

async function rewriteRule(user: User, rule: string, now: Date): Promise<string | null> {
  if (!(await modelReady(user.id))) return null;
  try {
    await getDb().transaction((tx) => reserveBackgroundModelCall(tx, user.id, now));
  } catch (err) {
    logger.info('meeting prep rule fallback', {
      userId: user.id,
      reason: err instanceof DeferredAgentJobError ? 'DAILY_MODEL_BUDGET' : 'budget',
    });
    return null;
  }
  try {
    if (rewriteOverride) return await rewriteOverride(user, rule);
    const memory = await loadAgentMemory(user.id, 'notify', rule);
    const result = await runProposalPass<SubmitNotificationArgs>({
      user,
      capability: 'agent.notify',
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `规则提醒：${rule}\n长期偏好：${memory.map((item) => item.content).join('；')}`,
      makeTool: submitNotificationTool,
    });
    return result?.args.message ?? null;
  } catch (err) {
    logger.info('meeting prep rule fallback', {
      userId: user.id,
      reason: err instanceof Error ? err.message : 'error',
    });
    return null;
  }
}

/**
 * Fill the card at send time. No related task or note cancels the row before publish.
 * A saved prepRule is the crash fallback and is not rewritten again.
 */
export async function prepareMeetingPrep(
  user: User,
  job: NotificationOutboxRow,
  now: Date,
): Promise<'ready' | 'stop'> {
  const zone = user.timezone || 'Asia/Shanghai';
  if (!user.notifyMeetingPrep) {
    await cancel(job.id, now, 'meeting prep off');
    return 'stop';
  }
  const [task] = await getDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, job.entityId), eq(tasks.userId, user.id)))
    .limit(1);
  if (
    !task ||
    task.deletedAt ||
    task.calendarKey === null ||
    task.habitId !== null ||
    task.isAllDay ||
    (task.status !== 'todo' && task.status !== 'doing') ||
    task.startAt === null
  ) {
    await cancel(job.id, now, 'meeting gone');
    return 'stop';
  }
  if (task.startAt.getTime() !== job.occurrenceAt.getTime()) {
    await cancel(job.id, now, 'start moved');
    return 'stop';
  }
  const quietUntil = applyQuietHours(now, user.quietHoursStart, user.quietHoursEnd, zone);
  if (quietUntil.getTime() > now.getTime() + 1_000) {
    if (quietUntil.getTime() >= task.startAt.getTime()) {
      await cancel(job.id, now, 'quiet hours cover the meeting');
      return 'stop';
    }
    await getDb()
      .update(notificationOutbox)
      .set({ status: 'pending', scheduledAt: quietUntil, updatedAt: now })
      .where(claimed(job.id));
    return 'stop';
  }

  const savedRule = job.payload.prepRule;
  if (savedRule) {
    const message = job.payload.message?.trim() || savedRule;
    const payload: NotificationOutboxPayload = {
      ...job.payload,
      eventType: 'meeting.prep',
      title: MEETING_PREP_TITLE,
      timezone: zone,
      message,
      prepRule: savedRule,
      deeplink: MEETING_PREP_PATH,
      taskId: task.id,
    };
    if (!(await savePayload(job, payload, now))) return 'stop';
    return 'ready';
  }

  const hits = await loadMeetingPrepHits(
    user.id,
    { id: task.id, title: task.title, outcomeId: task.outcomeId },
    now,
  );
  if (hits.tasks.length === 0 && hits.inbox.length === 0) {
    await cancel(job.id, now, 'no match');
    return 'stop';
  }
  const relatedTitles = [...hits.tasks, ...hits.inbox].map((hit) => hit.title);
  const rule = meetingPrepMessage(
    task.title,
    hits.tasks.map((hit) => hit.title),
    hits.inbox.map((hit) => hit.title),
  );
  const payload: NotificationOutboxPayload = {
    ...job.payload,
    eventType: 'meeting.prep',
    title: MEETING_PREP_TITLE,
    listId: task.listId,
    timezone: zone,
    message: rule,
    prepRule: rule,
    deeplink: MEETING_PREP_PATH,
    taskId: task.id,
    relatedTaskIds: hits.tasks.map((hit) => hit.id),
    relatedInboxIds: hits.inbox.map((hit) => hit.id),
  };
  if (!(await savePayload(job, payload, now))) return 'stop';
  const polished = await rewriteRule(user, rule, now);
  const message = polished ? acceptMeetingPrepText(polished, task.title, relatedTitles, rule) : rule;
  if (message !== rule && !(await savePayload(job, { ...payload, message }, now))) return 'stop';
  return 'ready';
}

/**
 * One pending row per calendar task start. The poll scans `lead + poll` ahead
 * and schedules the send for 15 minutes before start (or now, if that moment passed).
 * Matching happens at send time so a miss cancels instead of pushing.
 */
export async function enqueueMeetingPreps(now = new Date()): Promise<number> {
  const lookaheadMs = MEETING_PREP_LEAD_MS + config.WORKER_POLL_MS;
  const horizon = new Date(now.getTime() + lookaheadMs);
  const rows = await getDb()
    .select({
      taskId: tasks.id,
      startAt: tasks.startAt,
      userId: users.id,
      timezone: users.timezone,
      quietHoursStart: users.quietHoursStart,
      quietHoursEnd: users.quietHoursEnd,
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.userId))
    .where(
      and(
        eq(users.notifyMeetingPrep, true),
        isNull(tasks.deletedAt),
        isNull(tasks.habitId),
        isNotNull(tasks.calendarKey),
        eq(tasks.isAllDay, false),
        inArray(tasks.status, [...OPEN]),
        isNotNull(tasks.startAt),
        gt(tasks.startAt, now),
        lte(tasks.startAt, horizon),
      ),
    );
  let inserted = 0;
  for (const row of rows) {
    if (row.startAt === null) continue;
    const zone = row.timezone || 'Asia/Shanghai';
    const scheduledAt = meetingPrepFire(
      now,
      row.startAt,
      row.quietHoursStart,
      row.quietHoursEnd,
      zone,
      lookaheadMs,
    );
    if (!scheduledAt) continue;
    const payload: NotificationOutboxPayload = {
      title: MEETING_PREP_TITLE,
      listId: '',
      listName: '',
      dueAt: null,
      remindAt: null,
      isAllDay: false,
      timezone: zone,
      eventType: 'meeting.prep',
      message: MEETING_PREP_TITLE,
      deeplink: MEETING_PREP_PATH,
      taskId: row.taskId,
    };
    const created = await getDb()
      .insert(notificationOutbox)
      .values({
        id: randomUUID(),
        userId: row.userId,
        eventType: 'meeting.prep',
        entityType: 'task',
        entityId: row.taskId,
        occurrenceAt: row.startAt,
        idempotencyKey: meetingPrepKey(row.taskId, row.startAt),
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
      .onConflictDoNothing()
      .returning({ id: notificationOutbox.id });
    inserted += created.length;
  }
  return inserted;
}
