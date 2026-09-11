import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { AgentScheduleItem, AgentScheduleStatus } from '@vital/dto';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { agentJobs, agentScheduling, tasks } from '../db/schema.js';
import { enqueueAgentJob, type AgentDb } from './jobs.js';
import { lockAgentUser } from './user-lock.js';

export type ScheduledCapability = 'outcome.cluster' | 'memory.distill';
export const SCHEDULED_CAPABILITIES: readonly ScheduledCapability[] = ['outcome.cluster', 'memory.distill'];

type SchedulingRow = typeof agentScheduling.$inferSelect;

/** Locked order: idle → waiting → due → cooldown. A due row with an active cooldown reports 'due'. */
export function deriveScheduleStatus(row: Pick<SchedulingRow, 'generation' | 'processedGeneration' | 'pendingCount' | 'dueAt' | 'cooldownUntil'>, now: Date): AgentScheduleStatus {
  const hasPending = row.pendingCount > 0 && row.generation > row.processedGeneration;
  if (!hasPending) return 'idle';
  if (row.dueAt !== null) return +row.dueAt > +now ? 'waiting' : 'due';
  if (row.cooldownUntil !== null && +row.cooldownUntil > +now) return 'cooldown';
  // Pending without a dueAt or cooldown: waiting for the next worker scan.
  return 'due';
}

function toScheduleItem(row: SchedulingRow, now: Date): AgentScheduleItem {
  return {
    capability: row.capability as AgentScheduleItem['capability'],
    generation: row.generation,
    processedGeneration: row.processedGeneration,
    pendingCount: row.pendingCount,
    urgent: row.urgent,
    pendingSince: row.pendingSince?.toISOString() ?? null,
    dueAt: row.dueAt?.toISOString() ?? null,
    cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
    lastSucceededAt: row.lastSucceededAt?.toISOString() ?? null,
    observedAt: row.observedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    status: deriveScheduleStatus(row, now),
  };
}

function idleScheduleItem(capability: ScheduledCapability): AgentScheduleItem {
  return {
    capability,
    generation: 0,
    processedGeneration: 0,
    pendingCount: 0,
    urgent: false,
    pendingSince: null,
    dueAt: null,
    cooldownUntil: null,
    lastSucceededAt: null,
    observedAt: null,
    updatedAt: new Date().toISOString(),
    status: 'idle',
  };
}

/** Read-only schedule view: one row per scheduled capability, missing rows synthesized as idle. */
export async function listAgentSchedule(userId: string, now = new Date()): Promise<{ items: AgentScheduleItem[] }> {
  const rows = await getDb()
    .select()
    .from(agentScheduling)
    .where(eq(agentScheduling.userId, userId));
  const byCapability = new Map(rows.map((row) => [row.capability, row]));
  return {
    items: SCHEDULED_CAPABILITIES.map((capability) => {
      const row = byCapability.get(capability);
      return row ? toScheduleItem(row, now) : idleScheduleItem(capability);
    }),
  };
}

/**
 * Cancel the accumulated pending observations of a capability — the same
 * consumption semantics as finishAgentSchedule, but without running anything:
 * processedGeneration catches up to generation, so the pending counters clear
 * and future user activity re-marks on top (generation + 1). This is NOT
 * disabling the capability, and it never claims success (no cooldown, no
 * lastSucceededAt). Idempotent: cancelling with nothing pending is a no-op
 * that returns the (idle) state.
 */
export async function cancelAgentSchedule(userId: string, capability: ScheduledCapability, now = new Date()): Promise<AgentScheduleItem> {
  return getDb().transaction(async (tx) => {
    await lockAgentUser(tx, userId);
    const [row] = await tx
      .select()
      .from(agentScheduling)
      .where(and(eq(agentScheduling.userId, userId), eq(agentScheduling.capability, capability)))
      .for('update');
    if (!row) return idleScheduleItem(capability);
    const [updated] = await tx
      .update(agentScheduling)
      .set({
        processedGeneration: sql`GREATEST(${agentScheduling.processedGeneration}, ${agentScheduling.generation})`,
        pendingCount: 0,
        pendingSince: null,
        urgent: false,
        dueAt: null,
        updatedAt: now,
      })
      .where(and(eq(agentScheduling.userId, userId), eq(agentScheduling.capability, capability)))
      .returning();
    // The row existed under lock, but keep the fallback instead of a non-null assertion.
    return updated ? toScheduleItem(updated, now) : idleScheduleItem(capability);
  });
}
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
