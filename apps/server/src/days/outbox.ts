import { randomUUID } from 'node:crypto';
import { DEFAULT_NOTIFICATION_PREFS, type DayReminderOffset } from '@vital/dto';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getDb, type Database } from '../db/index.js';
import { days, notificationOutbox, users, type DayRow, type User } from '../db/schema.js';
import { applyQuietHours, parseHHmm } from '../notifications/quiet-hours.js';
import { computeOccurrence, type DayOccurrenceInput } from './compute.js';
import { addDaysYmd } from './lunar.js';

export type NotificationDb = Pick<Database, 'insert' | 'update' | 'delete' | 'select'>;

const LIVE = ['pending', 'sending'] as const;
const MISSED_GRACE_MS = 15 * 60 * 1000;

function occurrenceInput(row: DayRow): DayOccurrenceInput {
  return {
    calendar: row.calendar === 'lunar' ? 'lunar' : 'solar',
    repeat: row.repeat === 'yearly' ? 'yearly' : 'none',
    displayMode:
      row.displayMode === 'countdown' || row.displayMode === 'countup' ? row.displayMode : 'auto',
    anchorYmd: row.anchorYmd,
    lunarMonth: row.lunarMonth,
    lunarDay: row.lunarDay,
    lunarLeap: row.lunarLeap,
    catalogKey: row.catalogKey,
  };
}

function wallTime(ymd: string, hm: string, zone: string): Date {
  const { hour, minute } = parseHHmm(hm);
  return DateTime.fromISO(ymd, { zone }).set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
}

function dayRemindKey(dayId: string, occurrenceYmd: string, offset: DayReminderOffset): string {
  return `day.remind:${dayId}:${occurrenceYmd}:${String(offset)}`;
}

async function cancelLive(
  db: NotificationDb,
  dayId: string,
  now: Date,
  keepKeys: string[],
): Promise<void> {
  const cond =
    keepKeys.length > 0
      ? and(
          eq(notificationOutbox.entityType, 'day'),
          eq(notificationOutbox.eventType, 'day.remind'),
          eq(notificationOutbox.entityId, dayId),
          inArray(notificationOutbox.status, [...LIVE]),
          notInArray(notificationOutbox.idempotencyKey, keepKeys),
        )
      : and(
          eq(notificationOutbox.entityType, 'day'),
          eq(notificationOutbox.eventType, 'day.remind'),
          eq(notificationOutbox.entityId, dayId),
          inArray(notificationOutbox.status, [...LIVE]),
        );
  await db.update(notificationOutbox).set({ status: 'cancelled', updatedAt: now }).where(cond);
}

export async function cancelDayNotifications(
  dayId: string,
  now = new Date(),
  db: NotificationDb = getDb(),
): Promise<void> {
  await cancelLive(db, dayId, now, []);
}

function plansFor(
  row: DayRow,
  user: User,
  now: Date,
): { key: string; scheduledAt: Date; occurrenceAt: Date; occurrenceYmd: string; offset: DayReminderOffset }[] {
  if (row.hidden) return [];
  if (!user.notifyDayRemind) return [];
  const offsets = row.reminderOffsets;
  if (!Array.isArray(offsets) || offsets.length === 0) return [];
  const zone = user.timezone || 'Asia/Shanghai';
  const today = DateTime.fromJSDate(now).setZone(zone).toISODate();
  if (!today) return [];
  const hm = row.timeHm || user.allDayNotifyTime || DEFAULT_NOTIFICATION_PREFS.allDayNotifyTime;
  const input = occurrenceInput(row);
  const out: {
    key: string;
    scheduledAt: Date;
    occurrenceAt: Date;
    occurrenceYmd: string;
    offset: DayReminderOffset;
  }[] = [];

  const allowed: DayReminderOffset[] = [0, 1, 3, 7, 30];
  for (const offset of allowed.filter((item) => offsets.includes(item))) {
    let from = today;
    for (let i = 0; i < 4; i += 1) {
      const occ = computeOccurrence(input, from).nextYmd;
      if (!occ) break;
      const scheduledYmd = addDaysYmd(occ, -offset);
      let scheduledAt = wallTime(scheduledYmd, hm, zone);
      scheduledAt = applyQuietHours(scheduledAt, user.quietHoursStart, user.quietHoursEnd, zone);
      if (scheduledAt.getTime() >= now.getTime() - MISSED_GRACE_MS) {
        out.push({
          key: dayRemindKey(row.id, occ, offset),
          scheduledAt,
          occurrenceAt: wallTime(occ, hm, zone),
          occurrenceYmd: occ,
          offset,
        });
        break;
      }
      from = addDaysYmd(occ, 1);
    }
  }
  return out;
}

function messageOf(row: DayRow, offset: DayReminderOffset, occurrenceYmd: string, zone: string): string {
  const today = DateTime.now().setZone(zone).toISODate() ?? occurrenceYmd;
  const occ = computeOccurrence(occurrenceInput(row), today);
  if (offset === 0) return `「${row.name}」就是今天`;
  if (occ.headline.kind === 'countdown') {
    return `「${row.name}」还有 ${String(offset)} 天`;
  }
  return `「${row.name}」提醒`;
}

export async function syncDayNotifications(
  row: DayRow,
  user: User,
  now = new Date(),
  db: NotificationDb = getDb(),
): Promise<void> {
  const plans = plansFor(row, user, now);
  await cancelLive(
    db,
    row.id,
    now,
    plans.map((item) => item.key),
  );
  if (plans.length === 0) return;
  const zone = user.timezone || 'Asia/Shanghai';
  for (const plan of plans) {
    const payload = {
      title: row.name,
      listId: '',
      listName: '',
      dueAt: plan.occurrenceAt.toISOString(),
      remindAt: plan.scheduledAt.toISOString(),
      isAllDay: row.timeHm === null,
      timezone: zone,
      eventType: 'day.remind' as const,
      message: messageOf(row, plan.offset, plan.occurrenceYmd, zone),
    };
    await db
      .insert(notificationOutbox)
      .values({
        id: randomUUID(),
        userId: row.userId,
        eventType: 'day.remind',
        entityType: 'day',
        entityId: row.id,
        occurrenceAt: plan.occurrenceAt,
        idempotencyKey: plan.key,
        scheduledAt: plan.scheduledAt,
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: null,
        lastError: null,
        payload,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: notificationOutbox.idempotencyKey,
        set: {
          scheduledAt: plan.scheduledAt,
          payload,
          nextAttemptAt: null,
          lastError: null,
          updatedAt: now,
          status: sql`CASE WHEN ${notificationOutbox.status} = 'sent' THEN 'sent' ELSE 'pending' END`,
          attemptCount: sql`CASE WHEN ${notificationOutbox.status} = 'sent' THEN ${notificationOutbox.attemptCount} ELSE 0 END`,
        },
      });
  }
}

export async function healDayNotifications(now = new Date(), pageSize = 200): Promise<number> {
  const db = getDb();
  const rows = await db
    .select()
    .from(days)
    .where(eq(days.hidden, false))
    .limit(pageSize);
  if (rows.length === 0) return 0;
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const userRows = await db.select().from(users).where(inArray(users.id, userIds));
  const byUser = new Map(userRows.map((user) => [user.id, user]));
  for (const row of rows) {
    const user = byUser.get(row.userId);
    if (!user) continue;
    if (!Array.isArray(row.reminderOffsets) || row.reminderOffsets.length === 0) continue;
    await syncDayNotifications(row, user, now, db);
  }
  return rows.length;
}
