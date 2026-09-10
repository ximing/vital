import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import {
  notificationChannels,
  notificationDeliveries,
  notificationOutbox,
  tasks,
  users,
  type NotificationChannelRow,
  type NotificationOutboxPayload,
  type NotificationOutboxRow,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { sendMeow } from './meow.js';
import { syncTaskNotifications } from './outbox.js';
import { applyQuietHours } from './quiet-hours.js';
import { insightStillEligible } from './insights.js';

const BACKOFF_MS = [30_000, 120_000, 300_000, 900_000, 3_600_000, 14_400_000, 43_200_000];
const MAX_ATTEMPTS = 8;
const STUCK_MS = 5 * 60_000;

function iconUrl(): string {
  return config.NOTIFY_ICON_URL ?? `${config.WEB_ORIGIN.replace(/\/$/, '')}/meow-icon.png`;
}

function taskUrl(listId: string, taskId: string): string {
  return `${config.WEB_ORIGIN.replace(/\/$/, '')}/todos/lists/${listId}?task=${taskId}`;
}

function todayUrl(): string { return `${config.WEB_ORIGIN.replace(/\/$/, '')}/today`; }

function formatWhen(payload: NotificationOutboxPayload): string {
  const iso = payload.eventType === 'task.remind' ? payload.remindAt : payload.dueAt;
  if (!iso) return '';
  const dt = DateTime.fromISO(iso, { zone: payload.timezone });
  if (!dt.isValid) return '';
  if (payload.isAllDay) return dt.toFormat('yyyy-LL-dd');
  return dt.toFormat('yyyy-LL-dd HH:mm');
}

export function renderMeowMessage(payload: NotificationOutboxPayload): { title: string; msg: string } {
  if (payload.eventType === 'agent.insight') return { title: '系统主动提醒', msg: payload.message ?? payload.title };
  const when = formatWhen(payload);
  if (payload.eventType === 'task.remind') {
    return {
      title: '任务提醒',
      msg: when ? `「${payload.title}」提醒到了（${when}）` : `「${payload.title}」提醒到了`,
    };
  }
  return {
    title: '任务到期',
    msg: when ? `「${payload.title}」到期（${when}）` : `「${payload.title}」已到期`,
  };
}

export async function recoverStuckSending(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_MS);
  const rows = await getDb()
    .update(notificationOutbox)
    .set({ status: 'pending', updatedAt: now })
    .where(and(eq(notificationOutbox.status, 'sending'), lt(notificationOutbox.updatedAt, cutoff)))
    .returning({ id: notificationOutbox.id });
  return rows.length;
}

async function claimDue(now: Date, limit: number): Promise<NotificationOutboxRow[]> {
  const result = await getDb().execute(sql`
    UPDATE notification_outbox AS o
    SET status = 'sending', updated_at = ${now}
    FROM (
      SELECT id FROM notification_outbox
      WHERE status = 'pending'
        AND scheduled_at <= ${now}
        AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
      ORDER BY scheduled_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) AS picked
    WHERE o.id = picked.id
    RETURNING o.id
  `);
  const ids = (result.rows as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return [];
  return getDb().select().from(notificationOutbox).where(inArray(notificationOutbox.id, ids));
}

async function sendChannel(
  channel: NotificationChannelRow,
  job: NotificationOutboxRow,
): Promise<{ ok: boolean; permanent: boolean; error?: string }> {
  if (channel.type !== 'meow') {
    return { ok: false, permanent: true, error: '不支持的通知渠道' };
  }
  const copy = renderMeowMessage(job.payload);
  const result = await sendMeow({
    nickname: channel.config.nickname,
    title: copy.title,
    msg: copy.msg,
    url: job.eventType === 'agent.insight' ? todayUrl() : taskUrl(job.payload.listId, job.entityId),
    imgUrl: iconUrl(),
  });
  if (result.ok) return { ok: true, permanent: false };
  return { ok: false, permanent: result.permanent, error: result.error };
}

async function recordDelivery(
  outboxId: string,
  channelId: string,
  result: { ok: boolean; permanent: boolean; error?: string },
  now: Date,
): Promise<void> {
  await getDb()
    .insert(notificationDeliveries)
    .values({
      id: randomUUID(),
      outboxId,
      channelId,
      status: result.ok ? 'sent' : 'failed',
      permanent: result.ok ? false : result.permanent,
      lastError: result.ok ? null : (result.error ?? '发送失败').slice(0, 500),
      sentAt: result.ok ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [notificationDeliveries.outboxId, notificationDeliveries.channelId],
      set: {
        status: result.ok ? 'sent' : 'failed',
        permanent: result.ok ? false : result.permanent,
        lastError: result.ok ? null : (result.error ?? '发送失败').slice(0, 500),
        sentAt: result.ok ? now : null,
        updatedAt: now,
      },
    });
}

async function dispatchOne(job: NotificationOutboxRow, now: Date): Promise<void> {
  const [user] = await getDb().select().from(users).where(eq(users.id, job.userId)).limit(1);
  if (!user) {
    await getDb()
      .update(notificationOutbox)
      .set({ status: 'cancelled', updatedAt: now, lastError: 'user gone' })
      .where(eq(notificationOutbox.id, job.id));
    return;
  }
  if (job.eventType === 'agent.insight') {
    const kind = job.payload.insightKind;
    if (!kind || !(await insightStillEligible(user, job.entityId, kind, now))) {
      await getDb().update(notificationOutbox).set({ status: 'cancelled', updatedAt: now, lastError: 'insight expired or disabled' }).where(eq(notificationOutbox.id, job.id));
      return;
    }
  }
  const delayed = applyQuietHours(now, user.quietHoursStart, user.quietHoursEnd, user.timezone);
  if (delayed.getTime() > now.getTime() + 1_000) {
    await getDb()
      .update(notificationOutbox)
      .set({ status: 'pending', scheduledAt: delayed, updatedAt: now })
      .where(eq(notificationOutbox.id, job.id));
    return;
  }

  const channels = await getDb()
    .select()
    .from(notificationChannels)
    .where(and(eq(notificationChannels.userId, job.userId), eq(notificationChannels.enabled, true)));
  if (channels.length === 0) {
    await getDb()
      .update(notificationOutbox)
      .set({ status: 'pending', updatedAt: now, nextAttemptAt: new Date(now.getTime() + 60_000) })
      .where(eq(notificationOutbox.id, job.id));
    return;
  }

  const existing = await getDb()
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.outboxId, job.id));
  const done = new Map(existing.map((d) => [d.channelId, d]));

  let pendingWork = false;
  let anyRetryable = false;
  let lastError: string | null = null;

  for (const channel of channels) {
    const prior = done.get(channel.id);
    if (prior?.status === 'sent' || (prior?.status === 'failed' && prior.permanent)) continue;
    const result = await sendChannel(channel, job);
    await recordDelivery(job.id, channel.id, result, now);
    if (result.ok) {
      await getDb()
        .update(notificationChannels)
        .set({ lastSuccessAt: now, lastError: null, updatedAt: now })
        .where(eq(notificationChannels.id, channel.id));
    } else {
      lastError = result.error ?? '发送失败';
      await getDb()
        .update(notificationChannels)
        .set({ lastError, updatedAt: now })
        .where(eq(notificationChannels.id, channel.id));
      if (!result.permanent) anyRetryable = true;
    }
    pendingWork = true;
  }

  const after = await getDb()
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.outboxId, job.id));
  const byChannel = new Map(after.map((d) => [d.channelId, d]));
  const allDone = channels.every((ch) => {
    const d = byChannel.get(ch.id);
    return d?.status === 'sent' || (d?.status === 'failed' && d.permanent);
  });
  const allSent = channels.every((ch) => byChannel.get(ch.id)?.status === 'sent');

  if (allSent) {
    await getDb()
      .update(notificationOutbox)
      .set({ status: 'sent', sentAt: now, lastError: null, updatedAt: now })
      .where(eq(notificationOutbox.id, job.id));
    return;
  }
  if (allDone && !anyRetryable) {
    await getDb()
      .update(notificationOutbox)
      .set({ status: 'failed', lastError: lastError ?? '渠道永久失败', updatedAt: now })
      .where(eq(notificationOutbox.id, job.id));
    return;
  }

  const attempts = job.attemptCount + (pendingWork ? 1 : 0);
  if (attempts >= MAX_ATTEMPTS) {
    await getDb()
      .update(notificationOutbox)
      .set({
        status: 'failed',
        attemptCount: attempts,
        lastError: lastError ?? '重试次数用尽',
        updatedAt: now,
      })
      .where(eq(notificationOutbox.id, job.id));
    return;
  }
  const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 30_000;
  await getDb()
    .update(notificationOutbox)
    .set({
      status: 'pending',
      attemptCount: attempts,
      nextAttemptAt: new Date(now.getTime() + wait),
      lastError,
      updatedAt: now,
    })
    .where(eq(notificationOutbox.id, job.id));
}

export async function processDueNotifications(now = new Date()): Promise<number> {
  await recoverStuckSending(now);
  const claimed = await claimDue(now, config.WORKER_CLAIM_LIMIT);
  for (const job of claimed) {
    try {
      await dispatchOne(job, now);
    } catch (err) {
      logger.error('notification.dispatch.crash', err);
      await getDb()
        .update(notificationOutbox)
        .set({
          status: 'pending',
          attemptCount: job.attemptCount + 1,
          nextAttemptAt: new Date(now.getTime() + 30_000),
          lastError: 'dispatch crash',
          updatedAt: now,
        })
        .where(eq(notificationOutbox.id, job.id));
    }
  }
  return claimed.length;
}

export async function healTaskNotifications(now = new Date()): Promise<number> {
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(
      and(
        isNull(tasks.deletedAt),
        inArray(tasks.status, ['todo', 'doing']),
        or(
          sql`${tasks.dueAt} IS NOT NULL`,
          sql`${tasks.reminderAt} IS NOT NULL`,
          sql`${tasks.reminderMode} IN ('due', 'offset', 'custom')`,
        ),
      ),
    )
    .limit(200);
  let n = 0;
  for (const task of rows) {
    const [user] = await getDb().select().from(users).where(eq(users.id, task.userId)).limit(1);
    if (!user) continue;
    await syncTaskNotifications(task, user, now);
    n += 1;
  }
  return n;
}
