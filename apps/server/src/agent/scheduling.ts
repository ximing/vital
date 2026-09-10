import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { agentJobs, agentScheduling, tasks } from '../db/schema.js';
import { enqueueAgentJob, type AgentDb } from './jobs.js';
import { lockAgentUser } from './user-lock.js';

export type ScheduledCapability = 'outcome.cluster' | 'memory.distill';
const COOLDOWN_MS = 30 * 60_000;
export function scheduleDeadline(capability: ScheduledCapability, now: Date, pendingSince: Date | null, count: number, urgent: boolean, cooldown: Date | null): Date {
  const deadline = capability === 'outcome.cluster' ? +now + 120_000
    : count >= 3 || urgent ? +now + 300_000 : +(pendingSince ?? now) + 86_400_000;
  return new Date(Math.max(deadline, cooldown ? +cooldown : 0));
}

/** Caller must use the domain mutation transaction, so an event cannot be lost on a crash. */
export async function markAgentSchedule(db: AgentDb, userId: string, capability: ScheduledCapability, opts: { now?: Date; urgent?: boolean } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  await lockAgentUser(db, userId);
  const urgent = opts.urgent ?? false;
  const firstDue = scheduleDeadline(capability, now, null, 1, urgent, null);
  await db.insert(agentScheduling).values({ userId, capability, generation: 1, pendingCount: 1, urgent, pendingSince: now, dueAt: firstDue, observedAt: now, updatedAt: now }).onConflictDoUpdate({
    target: [agentScheduling.userId, agentScheduling.capability],
    set: {
      generation: sql`${agentScheduling.generation} + 1`,
      pendingCount: sql`${agentScheduling.pendingCount} + 1`,
      urgent: sql`${agentScheduling.urgent} OR ${urgent}`,
      pendingSince: sql`COALESCE(${agentScheduling.pendingSince}, ${now})`,
      observedAt: now,
      dueAt: capability === 'outcome.cluster'
        ? sql`GREATEST(${new Date(+now + 120_000)}, ${agentScheduling.cooldownUntil})`
        : sql`GREATEST(CASE WHEN ${agentScheduling.pendingCount} + 1 >= 3 OR ${agentScheduling.urgent} OR ${urgent} THEN ${new Date(+now + 300_000)} ELSE COALESCE(${agentScheduling.pendingSince}, ${now}) + interval '24 hours' END, ${agentScheduling.cooldownUntil})`,
      updatedAt: now,
    },
  });
}

/** Consume only the snapshot committed by this run. Events during execution stay dirty. */
export async function finishAgentSchedule(db: AgentDb, userId: string, capability: ScheduledCapability, generation: number, now = new Date()): Promise<void> {
  await db.update(agentScheduling).set({
    processedGeneration: sql`GREATEST(${agentScheduling.processedGeneration}, ${generation})`,
    pendingCount: sql`GREATEST(0, ${agentScheduling.generation} - ${generation})`,
    pendingSince: sql`CASE WHEN ${agentScheduling.generation} <= ${generation} THEN NULL ELSE ${agentScheduling.pendingSince} END`,
    urgent: sql`CASE WHEN ${agentScheduling.generation} <= ${generation} THEN false ELSE ${agentScheduling.urgent} END`,
    dueAt: sql`CASE WHEN ${agentScheduling.generation} <= ${generation} THEN NULL ELSE GREATEST(${agentScheduling.dueAt}, ${new Date(+now + COOLDOWN_MS)}) END`,
    cooldownUntil: new Date(+now + COOLDOWN_MS), lastSucceededAt: now, updatedAt: now,
  }).where(and(eq(agentScheduling.userId, userId), eq(agentScheduling.capability, capability), gt(agentScheduling.generation, 0)));
}

export async function dispatchAgentSchedule(userId: string, capability: ScheduledCapability, now = new Date(), manual = false): Promise<string | null> {
  return getDb().transaction(async (tx) => {
    await lockAgentUser(tx, userId);
    if (manual) await markAgentSchedule(tx, userId, capability, { now });
    const [state] = await tx.select().from(agentScheduling).where(and(eq(agentScheduling.userId, userId), eq(agentScheduling.capability, capability))).for('update');
    if (!state || (!manual && (state.generation <= state.processedGeneration || !state.dueAt || +state.dueAt > +now || (state.cooldownUntil && +state.cooldownUntil > +now)))) return null;
    if (!manual && capability === 'outcome.cluster') {
      const eligible = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt), isNull(tasks.habitId), isNull(tasks.outcomeId), inArray(tasks.status, ['todo', 'doing']))).limit(config.AGENT_CLUSTER_MIN_UNASSIGNED);
      if (eligible.length < config.AGENT_CLUSTER_MIN_UNASSIGNED) return null;
    }
    const dedupKey = `${capability}:${userId}`;
    const [job] = await tx.select().from(agentJobs).where(and(eq(agentJobs.userId, userId), eq(agentJobs.dedupKey, dedupKey))).limit(1);
    if (job && !manual && ((job.status === 'pending' || job.status === 'running') || +job.updatedAt + COOLDOWN_MS > +now)) return null;
    return enqueueAgentJob(tx, { userId, jobType: capability, dedupKey, scheduledAt: now, payload: { date: now.toISOString().slice(0, 10), scheduleGeneration: state.generation, scheduleFeedbackThrough: now.toISOString(), trigger: manual ? 'manual' : 'event', manual, mode: 'incremental' } });
  });
}
