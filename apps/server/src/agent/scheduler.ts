import { and, asc, eq, gt, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import {
  agentActions,
  agentEditEvents,
  agentEditFeedback,
  agentMemory,
  agentMemoryFeedback,
  agentMemoryMaintenance,
  agentScheduling,
  tasks,
  users,
} from '../db/schema.js';
import { spawnDailyHabits } from '../habits/habits.service.js';
import { enqueueAgentJobOnce } from './jobs.js';
import { dispatchAgentSchedule, markAgentSchedule, scheduleDeadline } from './scheduling.js';
import { lockAgentUser } from './user-lock.js';

const ACTIVE_WINDOW_MS = 7 * 24 * 3600 * 1000;

interface UserSignals {
  activityLatest: Date | null;
  feedbackCount: number;
  feedbackFirst: Date | null;
  feedbackLatest: Date | null;
  feedbackUrgent: boolean;
  editCount: number;
  editFirst: Date | null;
  editLatest: Date | null;
  maintenanceUpdatedAt: Date | null;
  memoryUpdatedAt: Date | null;
}

function emptySignals(): UserSignals {
  return {
    activityLatest: null,
    feedbackCount: 0,
    feedbackFirst: null,
    feedbackLatest: null,
    feedbackUrgent: false,
    editCount: 0,
    editFirst: null,
    editLatest: null,
    maintenanceUpdatedAt: null,
    memoryUpdatedAt: null,
  };
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(+date) ? null : date;
}

async function loadSignals(
  db: ReturnType<typeof getDb>,
  userIds: string[],
): Promise<Map<string, UserSignals>> {
  const out = new Map<string, UserSignals>();
  for (const id of userIds) out.set(id, emptySignals());
  if (userIds.length === 0) return out;

  const [activityRows, feedbackRows, editRows, maintenanceRows, memoryRows] = await Promise.all([
      db
        .select({ userId: tasks.userId, latest: max(tasks.updatedAt) })
        .from(tasks)
        .where(inArray(tasks.userId, userIds))
        .groupBy(tasks.userId),
      db
        .select({
          userId: agentActions.userId,
          count: sql<number>`count(*)::int`,
          first: sql<Date | null>`min(${agentActions.feedbackAt})`,
          latest: sql<Date | null>`max(${agentActions.feedbackAt})`,
          urgent: sql<boolean>`coalesce(bool_or(${agentActions.feedback} IN ('edited', 'dismissed', 'undone')), false)`,
        })
        .from(agentActions)
        .leftJoin(
          agentMemoryFeedback,
          sql`${agentMemoryFeedback.userId} = ${agentActions.userId}
            AND ${agentMemoryFeedback.actionId} = ${agentActions.id}
            AND ${agentMemoryFeedback.feedbackAt} = ${agentActions.feedbackAt}
            AND ${agentMemoryFeedback.version} = md5(${agentActions.feedback} || ':' || coalesce(${agentActions.feedbackPayload}::text, 'null') || ':' || ${agentActions.feedbackAt}::text)`,
        )
        .where(
          and(
            inArray(agentActions.userId, userIds),
            isNotNull(agentActions.feedbackAt),
            sql`${agentActions.feedback} <> 'pending'`,
            isNull(agentMemoryFeedback.userId),
          ),
        )
        .groupBy(agentActions.userId),
      db
        .select({
          userId: agentEditEvents.userId,
          count: sql<number>`count(*)::int`,
          first: sql<Date | null>`min(${agentEditEvents.createdAt})`,
          latest: sql<Date | null>`max(${agentEditEvents.createdAt})`,
        })
        .from(agentEditEvents)
        .leftJoin(
          agentEditFeedback,
          sql`${agentEditFeedback.userId} = ${agentEditEvents.userId} AND ${agentEditFeedback.eventId} = ${agentEditEvents.id}`,
        )
        .where(and(inArray(agentEditEvents.userId, userIds), isNull(agentEditFeedback.userId)))
        .groupBy(agentEditEvents.userId),
      db.select().from(agentMemoryMaintenance).where(inArray(agentMemoryMaintenance.userId, userIds)),
      db
        .select({ userId: agentMemory.userId, latest: max(agentMemory.updatedAt) })
        .from(agentMemory)
        .where(inArray(agentMemory.userId, userIds))
        .groupBy(agentMemory.userId),
    ]);

  for (const row of activityRows) {
    const rec = out.get(row.userId);
    if (rec) rec.activityLatest = asDate(row.latest);
  }
  for (const row of feedbackRows) {
    const rec = out.get(row.userId);
    if (!rec) continue;
    rec.feedbackCount = row.count;
    rec.feedbackFirst = asDate(row.first);
    rec.feedbackLatest = asDate(row.latest);
    rec.feedbackUrgent = row.urgent;
  }
  for (const row of editRows) {
    const rec = out.get(row.userId);
    if (!rec) continue;
    rec.editCount = row.count;
    rec.editFirst = asDate(row.first);
    rec.editLatest = asDate(row.latest);
  }
  for (const row of maintenanceRows) {
    const rec = out.get(row.userId);
    if (rec) rec.maintenanceUpdatedAt = asDate(row.updatedAt);
  }
  for (const row of memoryRows) {
    const rec = out.get(row.userId);
    if (rec) rec.memoryUpdatedAt = asDate(row.latest);
  }
  return out;
}

/** Keyset pagination covers inactive users with outstanding feedback and survives scheduler restarts. */
export async function runAgentScheduler(now = new Date()): Promise<number> {
  if (!config.AGENT_ENABLED) return 0;
  const db = getDb();
  let cursor: string | undefined;
  let scheduled = 0;
  for (;;) {
    const page = await db
      .select()
      .from(users)
      .where(cursor ? gt(users.id, cursor) : undefined)
      .orderBy(asc(users.id))
      .limit(200);
    if (!page.length) break;
    const signals = await loadSignals(
      db,
      page.map((user) => user.id),
    );
    for (const user of page) {
      const userId = user.id;
      const zoned = DateTime.fromJSDate(now).setZone(user.timezone);
      const day = zoned.toISODate() ?? now.toISOString().slice(0, 10);
      const rec = signals.get(userId) ?? emptySignals();
      await db.transaction(async (tx) => {
        await lockAgentUser(tx, userId);
        const states = await tx
          .select()
          .from(agentScheduling)
          .where(eq(agentScheduling.userId, userId))
          .for('update');
        const cluster = states.find((s) => s.capability === 'outcome.cluster');
        if (rec.activityLatest && (!cluster?.observedAt || +rec.activityLatest > +cluster.observedAt)) {
          await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
        }
        const memory = states.find((s) => s.capability === 'memory.distill');
        const timestamps = [rec.feedbackFirst, rec.feedbackLatest, rec.editFirst, rec.editLatest].flatMap(
          (d) => (d === null ? [] : [+d]),
        );
        const first = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
        const latest = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
        const totalCount = rec.feedbackCount + rec.editCount;
        const urgent = rec.feedbackUrgent || rec.editCount > 0;
        if (
          totalCount > 0 &&
          latest &&
          (!memory ||
            memory.generation === memory.processedGeneration ||
            !memory.observedAt ||
            +latest > +memory.observedAt)
        ) {
          await markAgentSchedule(tx, userId, 'memory.distill', { now, urgent });
          await tx
            .update(agentScheduling)
            .set({
              pendingCount: totalCount,
              pendingSince: first,
              urgent,
              dueAt: scheduleDeadline(
                'memory.distill',
                latest,
                first,
                totalCount,
                urgent,
                memory?.cooldownUntil ?? null,
              ),
              observedAt: now,
            })
            .where(and(eq(agentScheduling.userId, userId), eq(agentScheduling.capability, 'memory.distill')));
        }
      });
      await dispatchAgentSchedule(userId, 'outcome.cluster', now);
      await dispatchAgentSchedule(userId, 'memory.distill', now);
      if (rec.memoryUpdatedAt && (!rec.maintenanceUpdatedAt || +rec.memoryUpdatedAt > +rec.maintenanceUpdatedAt)) {
        await enqueueAgentJobOnce(db, {
          userId,
          jobType: 'memory.distill',
          payload: { date: day, mode: 'maintenance', trigger: 'daily-maintenance' },
          dedupKey: `memory.maintenance:${userId}:${day}`,
          scheduledAt: now,
        });
      }
      if (rec.activityLatest && +rec.activityLatest >= +now - ACTIVE_WINDOW_MS) {
        const notifySlot = zoned.startOf('minute').minus({ minutes: zoned.minute % 30 }).toFormat('yyyyLLddHHmm');
        await enqueueAgentJobOnce(db, {
          userId,
          jobType: 'notify.scan',
          payload: { date: day },
          dedupKey: `notify.scan:${userId}:${notifySlot}`,
          scheduledAt: now,
        });
        await enqueueAgentJobOnce(db, {
          userId,
          jobType: 'reflect.daily',
          payload: { date: day },
          dedupKey: `reflect.daily:${userId}:${day}`,
          scheduledAt: now,
        });
        await enqueueAgentJobOnce(db, {
          userId,
          jobType: 'index.sync',
          payload: { date: day },
          dedupKey: `index.sync:${userId}:${day}`,
          scheduledAt: now,
        });
        await spawnDailyHabits(userId, user.timezone, now);
        scheduled += 1;
      }
    }
    cursor = page[page.length - 1]?.id;
    if (page.length < 200) break;
  }
  return scheduled;
}
