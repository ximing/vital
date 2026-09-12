import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, type Database } from '../db/index.js';
import {
  agentActions,
  agentJobs,
  outcomes,
  type AgentJobPayload,
  type AgentJobRow,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { recoverStuckExecutions, telemetryErrorCode } from './executions.service.js';
import { DeferredAgentJobError, LostAgentJobLeaseError, heartbeatAgentJob, isRetryableAgentJobError, ownsAgentJob, runWithAgentJob } from './job-runtime.js';

export const BACKOFF_MS = [
  30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000,
] as const;
export const MAX_ATTEMPTS = 8;

/** Task-mutation triggers fire 30s out so mutation bursts collapse into one run. */
const TRIGGER_DELAY_MS = 30_000;

export type AgentDb = Pick<Database, 'insert' | 'update' | 'delete' | 'select'>;

/**
 * Thrown by processors when the switch has no case for job.jobType — i.e. an
 * old worker picked up a job written by newer code. processOne marks these
 * failed immediately (retrying can never fix an unknown type).
 */
export class UnknownAgentJobTypeError extends Error {
  constructor(jobType: string) {
    super(`unknown agent job type: ${jobType}`);
    this.name = 'UnknownAgentJobTypeError';
  }
}

export interface EnqueueAgentJobInput {
  userId: string;
  jobType: string;
  payload: AgentJobPayload;
  dedupKey: string;
  scheduledAt: Date;
}

/**
 * Upsert on dedup_key: a re-trigger re-arms scheduled_at (collapsing mutation
 * storms); a terminal job (done/failed/cancelled) is re-armed to pending.
 * Returns the job id, or null when the agent is disabled.
 */
export async function enqueueAgentJob(
  db: AgentDb,
  input: EnqueueAgentJobInput,
): Promise<string | null> {
  if (!config.AGENT_ENABLED) return null;
  const now = new Date();
  const [row] = await db
    .insert(agentJobs)
    .values({
      id: randomUUID(),
      userId: input.userId,
      jobType: input.jobType,
      payload: input.payload,
      dedupKey: input.dedupKey,
      scheduledAt: input.scheduledAt,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: agentJobs.dedupKey,
      setWhere: sql`${agentJobs.userId} = ${input.userId} AND ${agentJobs.jobType} = ${input.jobType}`,
      set: {
        generation: sql`${agentJobs.generation} + 1`,
        payload: input.payload,
        scheduledAt: input.scheduledAt,
        nextAttemptAt: null,
        lastError: null,
        updatedAt: now,
        status: sql`CASE WHEN ${agentJobs.status} IN ('pending', 'running') THEN ${agentJobs.status} ELSE 'pending' END`,
        attemptCount: sql`CASE WHEN ${agentJobs.status} = 'running' THEN ${agentJobs.attemptCount} ELSE 0 END`,
        firstAttemptAt: sql`CASE WHEN ${agentJobs.status} = 'running' THEN ${agentJobs.firstAttemptAt} ELSE NULL END`,
        claimedGeneration: sql`CASE WHEN ${agentJobs.status} = 'running' THEN ${agentJobs.claimedGeneration} ELSE NULL END`,
        claimedPayload: sql`CASE WHEN ${agentJobs.status} = 'running' THEN ${agentJobs.claimedPayload} ELSE NULL END`,
      },
    })
    .returning({ id: agentJobs.id });
  return row?.id ?? null;
}

/**
 * Idempotent insert for scheduler keys (reflect.daily:{user}:{day} etc.) —
 * an existing row in ANY state means the key already fired.
 */
export async function enqueueAgentJobOnce(
  db: AgentDb,
  input: EnqueueAgentJobInput,
): Promise<string | null> {
  if (!config.AGENT_ENABLED) return null;
  const now = new Date();
  const [row] = await db
    .insert(agentJobs)
    .values({
      id: randomUUID(),
      userId: input.userId,
      jobType: input.jobType,
      payload: input.payload,
      dedupKey: input.dedupKey,
      scheduledAt: input.scheduledAt,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: agentJobs.id });
  return row?.id ?? null;
}

/** Trigger hook: a task belonging to a thread changed → re-run its headline. */
export async function enqueueOutcomeRefresh(
  db: AgentDb,
  userId: string,
  outcomeId: string,
  now: Date,
  opts: { delayMs?: number; manual?: boolean } = {},
): Promise<void> {
  const id = await enqueueAgentJob(db, {
    userId,
    jobType: 'outcome.refresh',
    payload: { outcomeId, ...(opts.manual ? { manual: true, trigger: 'manual' } : { trigger: 'event' }) },
    dedupKey: `outcome.refresh:${outcomeId}`,
    scheduledAt: new Date(now.getTime() + (opts.delayMs ?? TRIGGER_DELAY_MS)),
  });
  if (id !== null) {
    await db
      .update(outcomes)
      .set({ agentState: 'pending' })
      .where(and(eq(outcomes.id, outcomeId), eq(outcomes.userId, userId)));
  }
}

/** Trigger hook: a task hit the defer threshold → ask the agent for a split. */
export async function enqueueTaskDecompose(
  db: AgentDb,
  userId: string,
  taskId: string,
  now: Date,
): Promise<void> {
  await enqueueAgentJob(db, {
    userId,
    jobType: 'task.decompose',
    payload: { taskId, trigger: 'event' },
    dedupKey: `task.decompose:${taskId}`,
    scheduledAt: new Date(now.getTime() + TRIGGER_DELAY_MS),
  });
}

/** Manual trigger: user asked for an execution-plan draft — run it right away. */
export async function enqueueTaskDraft(
  db: AgentDb,
  userId: string,
  taskId: string,
  now: Date,
): Promise<void> {
  await enqueueAgentJob(db, {
    userId,
    jobType: 'task.draft',
    payload: { taskId, manual: true, trigger: 'manual' },
    dedupKey: `task.draft:${taskId}`,
    scheduledAt: now,
  });
}

/** Manual trigger: write the daily report notes from today's facts. */
export async function enqueueReportGenerate(
  db: AgentDb,
  userId: string,
  reportId: string,
  now: Date,
): Promise<string | null> {
  return enqueueAgentJob(db, {
    userId,
    jobType: 'report.generate',
    payload: { reportId, manual: true, trigger: 'manual' },
    dedupKey: `report.generate:${reportId}`,
    scheduledAt: now,
  });
}

export async function hasPendingDecomposeAction(db: AgentDb, taskId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(
      and(
        eq(agentActions.userId, userId),
        eq(agentActions.targetType, 'task'),
        eq(agentActions.targetId, taskId),
        eq(agentActions.actionType, 'task.decompose'),
        eq(agentActions.feedback, 'pending'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function claimDueJobs(now: Date, limit: number): Promise<AgentJobRow[]> {
  if (limit <= 0) return [];
  return getDb().transaction(async (tx) => {
    // A short transaction lock closes the NOT EXISTS race between independent workers.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(721419, 1)`);
    const [running] = await tx.select({ n: sql<number>`count(*)::int` }).from(agentJobs).where(eq(agentJobs.status, 'running'));
    limit = Math.min(limit, Math.max(0, config.AGENT_CONCURRENCY - (running?.n ?? 0)));
    const claimed: AgentJobRow[] = [];
    for (let i = 0; i < limit; i++) {
      const result = await tx.execute(sql`
        SELECT j.id FROM agent_jobs j
        WHERE j.status = 'pending' AND j.scheduled_at <= ${now}
          AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= ${now})
          AND NOT EXISTS (SELECT 1 FROM agent_jobs busy WHERE busy.user_id = j.user_id
            AND busy.job_type = j.job_type AND busy.status = 'running')
        ORDER BY j.scheduled_at, j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED
      `);
      const id = (result.rows[0] as { id: string } | undefined)?.id;
      if (!id) break;
      const [row] = await tx.update(agentJobs).set({
        status: 'running', leaseToken: randomUUID(),
        leaseExpiresAt: new Date(now.getTime() + config.AGENT_LEASE_MS),
        claimedGeneration: sql`COALESCE(${agentJobs.claimedGeneration}, ${agentJobs.generation})`,
        claimedPayload: sql`COALESCE(${agentJobs.claimedPayload}, ${agentJobs.payload})`,
        firstAttemptAt: sql`COALESCE(${agentJobs.firstAttemptAt}, ${now})`, updatedAt: now,
      }).where(eq(agentJobs.id, id)).returning();
      if (row) claimed.push({ ...row, payload: row.claimedPayload ?? row.payload });
    }
    return claimed;
  });
}

/** Reconcile only telemetry owned by the expired lease, never healthy long requests. */
export async function recoverStuckAgentJobs(now = new Date()): Promise<number> {
  const recovered = await getDb().transaction(async (tx) => {
    const expired = await tx.execute(sql`SELECT id, lease_token FROM agent_jobs
      WHERE status = 'running' AND (lease_expires_at <= ${now} OR lease_expires_at IS NULL)
      FOR UPDATE SKIP LOCKED`);
    for (const row of expired.rows as Array<{ id: string; lease_token: string | null }>) {
      await tx.execute(sql`UPDATE agent_executions e SET
        status = CASE WHEN e.parent_id IS NULL AND EXISTS (SELECT 1 FROM agent_jobs j WHERE j.id = e.job_id AND j.applied_generation = e.job_generation) THEN 'succeeded' ELSE 'failed' END,
        reason = CASE WHEN e.parent_id IS NULL AND EXISTS (SELECT 1 FROM agent_jobs j WHERE j.id = e.job_id AND j.applied_generation = e.job_generation) THEN 'RECOVERED_COMMITTED' ELSE 'WORKER_INTERRUPTED' END,
        finished_at = ${now}, duration_ms = LEAST(2147483647, GREATEST(0, EXTRACT(EPOCH FROM (${now}::timestamptz - created_at)) * 1000))::int
        WHERE job_id = ${row.id} AND status = 'running' AND lease_token IS NOT DISTINCT FROM ${row.lease_token}`);
      await tx.execute(sql`UPDATE agent_usage SET status = 'failed', reason = 'WORKER_INTERRUPTED_USAGE_UNKNOWN',
        finished_at = ${now}, duration_ms = LEAST(2147483647, GREATEST(0, EXTRACT(EPOCH FROM (${now}::timestamptz - created_at)) * 1000))::int
        WHERE job_id = ${row.id} AND status = 'running' AND lease_token IS NOT DISTINCT FROM ${row.lease_token}`);
      await tx.update(agentJobs).set({ status: 'pending', leaseToken: null, leaseExpiresAt: null, updatedAt: now })
        .where(eq(agentJobs.id, row.id));
    }
    return expired.rows.length;
  });
  await recoverStuckExecutions(new Date(now.getTime() - config.AGENT_LEASE_MS));
  return recovered;
}

export async function finalizeAgentJob(job: AgentJobRow, result: string, now = new Date()): Promise<void> {
  await getDb().update(agentJobs).set({
    status: sql`CASE WHEN ${agentJobs.generation} > ${job.claimedGeneration} THEN 'pending' ELSE 'done' END`,
    attemptCount: sql`CASE WHEN ${agentJobs.generation} > ${job.claimedGeneration} THEN 0 ELSE ${job.attemptCount + 1} END`,
    firstAttemptAt: null, nextAttemptAt: null, leaseToken: null, leaseExpiresAt: null,
    claimedGeneration: null, claimedPayload: null, lastError: result === 'done' ? null : result, updatedAt: now,
  }).where(ownsAgentJob(job));
}

async function processOne(job: AgentJobRow, now: Date): Promise<void> {
  const startedAt = Date.now();
  const completedAt = () => new Date(now.getTime() + Date.now() - startedAt);
  let heartbeatBusy = false;
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    void heartbeatAgentJob(job).catch((err: unknown) => { logger.error('agent.heartbeat.failed', err); })
      .finally(() => { heartbeatBusy = false; });
  }, Math.min(config.AGENT_HEARTBEAT_MS, config.AGENT_LEASE_MS / 3));
  try {
    const { processAgentJob } = await import('./processors.js');
    const result = job.appliedGeneration === job.claimedGeneration
      ? 'done' : await runWithAgentJob(job, () => processAgentJob(job, now));
    await finalizeAgentJob(job, result, completedAt());
  } catch (err) {
    if (err instanceof LostAgentJobLeaseError) return;
    now = completedAt();
    const deferred = err instanceof DeferredAgentJobError;
    const attempts = job.attemptCount + (deferred ? 0 : 1);
    const exhausted = attempts >= config.AGENT_MAX_ATTEMPTS ||
      (job.firstAttemptAt !== null && now.getTime() - job.firstAttemptAt.getTime() >= config.AGENT_RETRY_MAX_AGE_MS);
    const terminal = !deferred && (exhausted || !isRetryableAgentJobError(err));
    const message = telemetryErrorCode(err);
    const wait = BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1)] ?? 30_000;
    await getDb().transaction(async (tx) => {
      const [owned] = await tx.select().from(agentJobs).where(ownsAgentJob(job)).for('update');
      if (!owned) return;
      const newer = owned.generation > (job.claimedGeneration ?? job.generation);
      const superseded = newer && (terminal || ('manual' in owned.payload && owned.payload.manual));
      await tx.update(agentJobs).set({
        status: terminal && !newer ? 'failed' : 'pending',
        attemptCount: superseded ? 0 : attempts,
        nextAttemptAt: superseded ? null : deferred ? err.nextAttemptAt : terminal ? null : new Date(now.getTime() + wait),
        claimedGeneration: terminal || superseded ? null : job.claimedGeneration,
        claimedPayload: terminal || superseded ? null : job.claimedPayload,
        firstAttemptAt: terminal || superseded ? null : job.firstAttemptAt,
        leaseToken: null, leaseExpiresAt: null, lastError: message, updatedAt: now,
      }).where(eq(agentJobs.id, job.id));
      if (terminal && !newer && job.jobType === 'outcome.refresh' && 'outcomeId' in job.payload) {
        await tx.update(outcomes).set({ agentState: 'failed' })
          .where(and(eq(outcomes.id, job.payload.outcomeId), eq(outcomes.userId, job.userId)));
      }
    });
  } finally { clearInterval(heartbeat); }
}

let stopping = false;
let polling = false;
const active = new Set<Promise<void>>();
export async function drainAgentJobs(): Promise<void> {
  stopping = true;
  while (polling || active.size > 0) {
    if (active.size) await Promise.allSettled([...active]);
    else await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function processDueAgentJobs(now = new Date()): Promise<number> {
  if (!config.AGENT_ENABLED || stopping || polling) return 0;
  polling = true;
  try {
    const capacity = Math.max(0, config.AGENT_CONCURRENCY - active.size);
    const claimed = await claimDueJobs(now, Math.min(capacity, config.WORKER_CLAIM_LIMIT));
    const started = claimed.map((job) => {
      const task = processOne(job, now).catch((err: unknown) => {
        // Do not write an unfenced fallback: the durable lease handles a crash here.
        logger.error('agent.job.crash', err);
      });
      active.add(task);
      void task.finally(() => active.delete(task));
      return task;
    });
    await Promise.all(started);
    return claimed.length;
  } finally { polling = false; }
}
