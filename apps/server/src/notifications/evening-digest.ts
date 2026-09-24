import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getDb } from '../db/index.js';
import { notificationOutbox, tasks, users, type NotificationOutboxPayload } from '../db/schema.js';
import { parseHHmm } from './quiet-hours.js';

/** Local clock for the once-a-day fallback. Morning all-day pings stay on allDayNotifyTime. */
export const EVENING_DIGEST_HM = '21:00';

export function eveningDigestMessage(count: number): string {
  return `今天还有 ${String(count)} 件没处理`;
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

/**
 * One pending row per user per local day, fired at 21:00.
 * Dispatch recounts open all-day tasks and drops the row when none remain.
 * Existing rows are left alone so a quiet-hours delay is not pulled back to 21:00.
 */
export async function enqueueEveningDigests(now = new Date()): Promise<number> {
  const people = await getDb().select().from(users).where(eq(users.notifyTaskDue, true));
  let inserted = 0;
  for (const user of people) {
    const zone = user.timezone || 'Asia/Shanghai';
    const slot = eveningDigestWhen(now, zone);
    if (!slot) continue;
    const payload: NotificationOutboxPayload = {
      title: '晚间提醒',
      listId: '',
      listName: '',
      dueAt: null,
      remindAt: null,
      isAllDay: false,
      timezone: zone,
      eventType: 'task.digest',
      message: eveningDigestMessage(0),
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
