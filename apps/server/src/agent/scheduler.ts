import { and, asc, eq, gt, isNotNull, max, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { agentActions, agentEditEvents, agentMemory, agentMemoryMaintenance, agentScheduling, tasks, users } from '../db/schema.js';
import { spawnDailyHabits } from '../habits/habits.service.js';
import { enqueueAgentJobOnce } from './jobs.js';
import { dispatchAgentSchedule, markAgentSchedule, scheduleDeadline } from './scheduling.js';
import { lockAgentUser } from './user-lock.js';

const ACTIVE_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** Keyset pagination covers inactive users with outstanding feedback and survives scheduler restarts. */
export async function runAgentScheduler(now = new Date()): Promise<number> {
  if (!config.AGENT_ENABLED) return 0;
  const db = getDb();
  let cursor: string | undefined;
  let scheduled = 0;
  for (;;) {
    const page = await db.select().from(users).where(cursor ? gt(users.id, cursor) : undefined).orderBy(asc(users.id)).limit(200);
    if (!page.length) break;
    for (const user of page) {
      const userId = user.id;
      const zoned = DateTime.fromJSDate(now).setZone(user.timezone);
      const day = zoned.toISODate() ?? now.toISOString().slice(0, 10);
      const [activity] = await db.select({ latest: max(tasks.updatedAt) }).from(tasks).where(eq(tasks.userId, userId));
      await db.transaction(async (tx) => {
        await lockAgentUser(tx, userId);
        const states = await tx.select().from(agentScheduling).where(eq(agentScheduling.userId, userId)).for('update');
        const cluster = states.find(s => s.capability === 'outcome.cluster');
        if (activity?.latest && (!cluster?.observedAt || +activity.latest > +cluster.observedAt)) {
          await markAgentSchedule(tx, userId, 'outcome.cluster', { now });
        }
        const feedback = await tx.select({ count: sql<number>`count(*)::int`, first: sql<Date | null>`min(${agentActions.feedbackAt})`, latest: sql<Date | null>`max(${agentActions.feedbackAt})`, urgent: sql<boolean>`coalesce(bool_or(${agentActions.feedback} IN ('edited', 'dismissed', 'undone')), false)` }).from(agentActions).where(and(
          eq(agentActions.userId, userId), isNotNull(agentActions.feedbackAt),
          sql`${agentActions.feedback} <> 'pending'`,
          sql`NOT EXISTS (SELECT 1 FROM agent_memory_feedback f WHERE f.user_id = ${userId} AND f.action_id = ${agentActions.id} AND f.feedback_at = ${agentActions.feedbackAt} AND f.version = md5(${agentActions.feedback} || ':' || coalesce(${agentActions.feedbackPayload}::text, 'null') || ':' || ${agentActions.feedbackAt}::text))`,
        ));
        // Unconsumed user edit events distill alongside action feedback — they are
        // the strongest correction signals the system gets.
        const edits = await tx.select({ count: sql<number>`count(*)::int`, first: sql<Date | null>`min(${agentEditEvents.createdAt})`, latest: sql<Date | null>`max(${agentEditEvents.createdAt})` }).from(agentEditEvents).where(and(
          eq(agentEditEvents.userId, userId),
          sql`NOT EXISTS (SELECT 1 FROM agent_edit_feedback f WHERE f.user_id = ${userId} AND f.event_id = ${agentEditEvents.id})`,
        ));
        const pending = feedback[0];
        const pendingEdits = edits[0];
        const memory = states.find(s => s.capability === 'memory.distill');
        // Aggregate timestamps from raw SQL can be strings with the pg driver.
        const timestamps = [pending?.first, pending?.latest, pendingEdits?.first, pendingEdits?.latest]
          .flatMap((d) => (d === null || d === undefined ? [] : [+new Date(d)]));
        const first = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
        const latest = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
        const totalCount = (pending?.count ?? 0) + (pendingEdits?.count ?? 0);
        const urgent = (pending?.urgent ?? false) || (pendingEdits?.count ?? 0) > 0;
        if (totalCount > 0 && latest && (!memory || memory.generation === memory.processedGeneration || !memory.observedAt || +latest > +memory.observedAt)) {
          await markAgentSchedule(tx, userId, 'memory.distill', { now, urgent });
          await tx.update(agentScheduling).set({ pendingCount: totalCount, pendingSince: first, urgent, dueAt: scheduleDeadline('memory.distill', latest, first, totalCount, urgent, memory?.cooldownUntil ?? null), observedAt: now }).where(and(eq(agentScheduling.userId, userId), eq(agentScheduling.capability, 'memory.distill')));
        }
      });
      await dispatchAgentSchedule(userId, 'outcome.cluster', now);
      await dispatchAgentSchedule(userId, 'memory.distill', now);
      const [maintenance] = await db.select().from(agentMemoryMaintenance).where(eq(agentMemoryMaintenance.userId, userId)).limit(1);
      const [memoryChange] = await db.select({ latest: max(agentMemory.updatedAt) }).from(agentMemory).where(eq(agentMemory.userId, userId));
      if (memoryChange?.latest && (!maintenance || +memoryChange.latest > +maintenance.updatedAt)) {
        await enqueueAgentJobOnce(db, { userId, jobType: 'memory.distill', payload: { date: day, mode: 'maintenance', trigger: 'daily-maintenance' }, dedupKey: `memory.maintenance:${userId}:${day}`, scheduledAt: now });
      }
      if (activity?.latest && +activity.latest >= +now - ACTIVE_WINDOW_MS) {
        const notifySlot = zoned.startOf('minute').minus({ minutes: zoned.minute % 30 }).toFormat('yyyyLLddHHmm');
        await enqueueAgentJobOnce(db, { userId, jobType: 'notify.scan', payload: { date: day }, dedupKey: `notify.scan:${userId}:${notifySlot}`, scheduledAt: now });
        await enqueueAgentJobOnce(db, { userId, jobType: 'reflect.daily', payload: { date: day }, dedupKey: `reflect.daily:${userId}:${day}`, scheduledAt: now });
        await enqueueAgentJobOnce(db, { userId, jobType: 'index.sync', payload: { date: day }, dedupKey: `index.sync:${userId}:${day}`, scheduledAt: now });
        await spawnDailyHabits(userId, user.timezone, now);
        scheduled += 1;
      }
    }
    cursor = page[page.length - 1]?.id;
    if (page.length < 200) break;
  }
  return scheduled;
}
