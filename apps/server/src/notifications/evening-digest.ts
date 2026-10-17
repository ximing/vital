import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getDb } from '../db/index.js';
import {
  notificationOutbox,
  outcomes,
  taskCompletions,
  tasks,
  users,
  type NotificationOutboxPayload,
  type NotificationOutboxRow,
  type User,
} from '../db/schema.js';
import { DeferredAgentJobError } from '../agent/job-runtime.js';
import { loadAgentMemory, runProposalPass } from '../agent/harness.js';
import { reserveBackgroundModelCall } from '../agent/model-budget.js';
import { submitNotificationTool, type SubmitNotificationArgs } from '../agent/tools.js';
import { resolveModelFor } from '../llm/pi.js';
import { loadLlmStore } from '../llm/store.js';
import { DEFER_THRESHOLD } from '../outcomes/rule-engine.js';
import { logger } from '../utils/logger.js';
import { hasLowEnergySafe } from '../energy/energy.service.js';
import { ENERGY_LOW_MAX } from './energy-link.js';
import { applyQuietHours, parseHHmm } from './quiet-hours.js';

/** Local clock for the once-a-day fallback. Morning all-day pings stay on allDayNotifyTime. */
export const EVENING_DIGEST_HM = '21:00';

const TITLE = '晚间提醒';
const OUTCOME_CAP = 3;

const SYSTEM_PROMPT = `你把晚间收口改写成一条中文手机通知，120 字以内。只使用规则底稿里的事实，不编造任务、进展或日期。
不要写「没处理」，也不要写「还有 N 件」。全部完成时先肯定，并保留明日那一件的标题。
底稿里若有「精力偏低」，必须保留这句和其中的标题。
不要标题，不要列表。必须调用 submit_notification。`;

export type EveningDigestKind = 'leftover' | 'done' | 'progress' | 'quiet';

export type EveningDigestFacts = {
  completed: number;
  /** Open all-day, non-habit tasks due today. Timed tasks keep their own due ping. */
  openToday: number;
  outcomes: string[];
  defer: { title: string; count: number } | null;
  tomorrow: string | null;
  /** Today has an energy log ≤ ENERGY_LOW_MAX. Quiet days still do not send. */
  lowEnergy?: boolean;
};

type EveningRewrite = (user: User, rule: string) => Promise<string | null>;

/** Test seam. Production leaves this null and calls agent.notify. */
let rewriteOverride: EveningRewrite | null = null;

export function setEveningDigestRewrite(next: EveningRewrite | null): void {
  rewriteOverride = next;
}

export function eveningDigestKind(facts: EveningDigestFacts): EveningDigestKind {
  if (facts.openToday > 0) return 'leftover';
  if (facts.completed > 0) return 'done';
  if (facts.outcomes.length > 0) return 'progress';
  return 'quiet';
}

/** Rule copy. Quiet days return an empty string and are not sent. */
export function eveningDigestMessage(facts: EveningDigestFacts): string {
  const kind = eveningDigestKind(facts);
  if (kind === 'quiet') return '';
  const parts: string[] = [];
  if (kind === 'done') {
    parts.push(`今天的都做完了，完成了 ${String(facts.completed)} 件`);
  } else if (kind === 'leftover') {
    parts.push(`今天完成了 ${String(facts.completed)} 件`);
  }
  if (facts.outcomes.length > 0) parts.push(`${facts.outcomes.join('、')}有推进`);
  if (facts.defer) {
    parts.push(`「${facts.defer.title}」已经连着推迟 ${String(facts.defer.count)} 次，可以先放下`);
  }
  if (facts.tomorrow) {
    parts.push(kind === 'done' ? `明天先做「${facts.tomorrow}」` : `明天可以先做「${facts.tomorrow}」`);
  } else if (kind === 'done') {
    parts.push('明天还没有排定的第一件');
  }
  if (facts.lowEnergy) {
    const move = facts.defer?.title ?? facts.tomorrow;
    const mark = `今天精力偏低（≤${String(ENERGY_LOW_MAX)}）`;
    parts.push(move ? `${mark}，「${move}」可以挪一挪` : `${mark}，可以少排一点`);
  }
  return parts.length === 0 ? '' : `${parts.join('。')}。`;
}

/** Keep a rewrite only when it does not nag or drop a name from the rule. */
export function acceptEveningDigestText(text: string, facts: EveningDigestFacts, rule: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed === '' || trimmed.length > 200) return rule;
  if (rule.includes('精力偏低') && !trimmed.includes('精力偏低')) return rule;
  if (/没处理|还有\s*\d+\s*件/.test(trimmed)) return rule;
  const kind = eveningDigestKind(facts);
  if (kind === 'done' && (trimmed.includes('还有') || !/做完|完成|收好/.test(trimmed))) return rule;
  if (facts.completed > 0 && !trimmed.includes(String(facts.completed))) return rule;
  const quoted = [...rule.matchAll(/「([^」]+)」/g)].map((match) => match[1] ?? '');
  if (quoted.some((name) => name !== '' && !trimmed.includes(name))) return rule;
  if (facts.outcomes.some((name) => !trimmed.includes(name))) return rule;
  return trimmed;
}

/** Today's 21:00, or `now` when that clock has already passed. */
export function eveningDigestWhen(
  now: Date,
  timeZone: string,
): { day: string; scheduledAt: Date } | null {
  const local = DateTime.fromJSDate(now, { zone: timeZone });
  const day = local.toISODate();
  if (!local.isValid || !day) return null;
  const { hour, minute } = parseHHmm(EVENING_DIGEST_HM);
  const slot = local.set({ hour, minute, second: 0, millisecond: 0 });
  const scheduledAt = slot.toMillis() > now.getTime() ? slot.toJSDate() : now;
  return { day, scheduledAt };
}

export async function countEveningDigestTasks(
  userId: string,
  timeZone: string,
  now: Date,
): Promise<number> {
  const local = DateTime.fromJSDate(now, { zone: timeZone });
  if (!local.isValid) return 0;
  const start = local.startOf('day').toUTC().toJSDate();
  const end = local.plus({ days: 1 }).startOf('day').toUTC().toJSDate();
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.habitId),
        eq(tasks.isAllDay, true),
        inArray(tasks.status, ['todo', 'doing']),
        gte(tasks.dueAt, start),
        lt(tasks.dueAt, end),
      ),
    );
  return row?.n ?? 0;
}

async function countCompleted(userId: string, start: Date, end: Date): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(taskCompletions)
    .innerJoin(tasks, eq(tasks.id, taskCompletions.taskId))
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.habitId),
        gte(taskCompletions.completedAt, start),
        lt(taskCompletions.completedAt, end),
      ),
    );
  return row?.n ?? 0;
}

async function outcomeNames(userId: string, start: Date, end: Date): Promise<string[]> {
  const db = getDb();
  const openOutcome = and(eq(outcomes.userId, userId), eq(outcomes.status, 'open'));
  const [touched, stamped] = await Promise.all([
    db
      .select({ name: outcomes.name })
      .from(outcomes)
      .innerJoin(tasks, and(eq(tasks.outcomeId, outcomes.id), eq(tasks.userId, userId)))
      .where(
        and(
          openOutcome,
          isNull(tasks.deletedAt),
          gte(tasks.updatedAt, start),
          lt(tasks.updatedAt, end),
        ),
      ),
    db
      .select({ name: outcomes.name })
      .from(outcomes)
      .where(and(openOutcome, gte(outcomes.lastActivityAt, start), lt(outcomes.lastActivityAt, end))),
  ]);
  return [...new Set([...touched, ...stamped].map((row) => row.name))]
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .slice(0, OUTCOME_CAP);
}

async function deferCandidate(userId: string): Promise<EveningDigestFacts['defer']> {
  const [row] = await getDb()
    .select({ title: tasks.title, count: tasks.deferCount })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.habitId),
        inArray(tasks.status, ['todo', 'doing']),
        gte(tasks.deferCount, DEFER_THRESHOLD),
      ),
    )
    .orderBy(desc(tasks.deferCount), asc(tasks.dueAt), asc(tasks.title))
    .limit(1);
  return row ? { title: row.title, count: row.count } : null;
}

async function tomorrowTask(userId: string, start: Date, end: Date): Promise<string | null> {
  const [row] = await getDb()
    .select({ title: tasks.title })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.habitId),
        inArray(tasks.status, ['todo', 'doing']),
        gte(tasks.dueAt, start),
        lt(tasks.dueAt, end),
      ),
    )
    .orderBy(asc(tasks.priority), asc(tasks.dueAt), asc(tasks.sortOrder), asc(tasks.title))
    .limit(1);
  return row?.title ?? null;
}

export async function loadEveningDigestFacts(
  userId: string,
  timeZone: string,
  now: Date,
): Promise<EveningDigestFacts> {
  const local = DateTime.fromJSDate(now, { zone: timeZone });
  if (!local.isValid) {
    return { completed: 0, openToday: 0, outcomes: [], defer: null, tomorrow: null };
  }
  const start = local.startOf('day').toUTC().toJSDate();
  const end = local.plus({ days: 1 }).startOf('day').toUTC().toJSDate();
  const tomorrowEnd = local.plus({ days: 2 }).startOf('day').toUTC().toJSDate();
  const [openToday, completed, names, defer, tomorrow, lowEnergy] = await Promise.all([
    countEveningDigestTasks(userId, timeZone, now),
    countCompleted(userId, start, end),
    outcomeNames(userId, start, end),
    deferCandidate(userId),
    tomorrowTask(userId, end, tomorrowEnd),
    hasLowEnergySafe(userId, timeZone, now, 'evening'),
  ]);
  return { completed, openToday, outcomes: names, defer, tomorrow, lowEnergy };
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

async function modelReady(userId: string): Promise<boolean> {
  if (rewriteOverride) return true;
  return resolveModelFor(await loadLlmStore(userId), 'agent.notify') !== null;
}

async function rewriteRule(user: User, rule: string, now: Date): Promise<string | null> {
  if (!(await modelReady(user.id))) return null;
  try {
    await getDb().transaction((tx) => reserveBackgroundModelCall(tx, user.id, now));
  } catch (err) {
    logger.info('evening digest rule fallback', {
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
    logger.info('evening digest rule fallback', {
      userId: user.id,
      reason: err instanceof Error ? err.name : 'error',
    });
    return null;
  }
}

/**
 * Fill the body at send time. The rule sentence is stored before the model runs,
 * so a crash recovers that sentence and does not pay for another rewrite.
 */
export async function prepareEveningDigest(
  user: User,
  job: NotificationOutboxRow,
  now: Date,
): Promise<'ready' | 'stop'> {
  const zone = user.timezone || 'Asia/Shanghai';
  if (!user.notifyTaskDue) {
    await cancel(job.id, now, 'task due notifications off');
    return 'stop';
  }
  const local = DateTime.fromJSDate(now, { zone });
  if (!local.isValid) {
    await cancel(job.id, now, 'invalid timezone');
    return 'stop';
  }
  const quietUntil = applyQuietHours(now, user.quietHoursStart, user.quietHoursEnd, zone);
  if (quietUntil.getTime() > now.getTime() + 1_000) {
    const sameDay = DateTime.fromJSDate(quietUntil, { zone }).toISODate() === local.toISODate();
    if (!sameDay) {
      await cancel(job.id, now, 'quiet hours crossed midnight');
      return 'stop';
    }
    await getDb()
      .update(notificationOutbox)
      .set({ status: 'pending', scheduledAt: quietUntil, updatedAt: now })
      .where(claimed(job.id));
    return 'stop';
  }
  const savedRule = job.payload.digestRule;
  if (savedRule) {
    const message = job.payload.message?.trim() || savedRule;
    const payload: NotificationOutboxPayload = {
      ...job.payload,
      eventType: 'task.digest',
      title: TITLE,
      timezone: zone,
      message,
      digestRule: savedRule,
    };
    if (!(await savePayload(job, payload, now))) return 'stop';
    return 'ready';
  }
  const facts = await loadEveningDigestFacts(user.id, zone, now);
  if (eveningDigestKind(facts) === 'quiet') {
    await cancel(job.id, now, 'no activity');
    return 'stop';
  }
  const rule = eveningDigestMessage(facts);
  const payload: NotificationOutboxPayload = {
    ...job.payload,
    eventType: 'task.digest',
    title: TITLE,
    timezone: zone,
    message: rule,
    digestRule: rule,
  };
  if (!(await savePayload(job, payload, now))) return 'stop';
  const polished = await rewriteRule(user, rule, now);
  const message = polished ? acceptEveningDigestText(polished, facts, rule) : rule;
  if (message !== rule && !(await savePayload(job, { ...payload, message }, now))) return 'stop';
  return 'ready';
}

/**
 * One pending row per user per local day, fired at 21:00.
 * Dispatch replaces the placeholder. Existing rows are left alone so a quiet-hours
 * delay is not pulled back to 21:00.
 */
export async function enqueueEveningDigests(now = new Date()): Promise<number> {
  const people = await getDb().select().from(users).where(eq(users.notifyTaskDue, true));
  let inserted = 0;
  for (const user of people) {
    const zone = user.timezone || 'Asia/Shanghai';
    const slot = eveningDigestWhen(now, zone);
    if (!slot) continue;
    const payload: NotificationOutboxPayload = {
      title: TITLE,
      listId: '',
      listName: '',
      dueAt: null,
      remindAt: null,
      isAllDay: false,
      timezone: zone,
      eventType: 'task.digest',
      message: TITLE,
    };
    const rows = await getDb()
      .insert(notificationOutbox)
      .values({
        id: randomUUID(),
        userId: user.id,
        eventType: 'task.digest',
        entityType: 'user',
        entityId: user.id,
        occurrenceAt: slot.scheduledAt,
        idempotencyKey: `task.digest:${user.id}:${slot.day}`,
        scheduledAt: slot.scheduledAt,
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
    inserted += rows.length;
  }
  return inserted;
}
