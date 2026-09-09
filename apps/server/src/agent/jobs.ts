import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
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

export const BACKOFF_MS = [
  30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000,
] as const;
export const MAX_ATTEMPTS = 8;
const STUCK_MS = 5 * 60_000;
/** Task-mutation triggers fire 30s out so mutation bursts collapse into one run. */
const TRIGGER_DELAY_MS = 30_000;

export type AgentDb = Pick<Database, 'insert' | 'update' | 'delete' | 'select'>;

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
      set: {
        payload: input.payload,
        scheduledAt: input.scheduledAt,
        nextAttemptAt: null,
        lastError: null,
        updatedAt: now,
        status: sql`CASE WHEN ${agentJobs.status} IN ('pending', 'running') THEN ${agentJobs.status} ELSE 'pending' END`,
        attemptCount: sql`CASE WHEN ${agentJobs.status} IN ('pending', 'running') THEN ${agentJobs.attemptCount} ELSE 0 END`,
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
  opts: { delayMs?: number } = {},
): Promise<void> {
  const id = await enqueueAgentJob(db, {
    userId,
    jobType: 'outcome.refresh',
    payload: { outcomeId },
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
    payload: { taskId },
    dedupKey: `task.decompose:${taskId}`,
    scheduledAt: new Date(now.getTime() + TRIGGER_DELAY_MS),
  });
}

export async function hasPendingDecomposeAction(db: AgentDb, taskId: string): Promise<boolean> {
  const rows = await db
    .select({ id: agentActions.id })
    .from(agentActions)
    .where(
      and(
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
  const result = await getDb().execute(sql`
    UPDATE agent_jobs AS j
    SET status = 'running', updated_at = ${now}
    FROM (
      SELECT id FROM agent_jobs
      WHERE status = 'pending'
        AND scheduled_at <= ${now}
        AND (next_attempt_at IS NULL OR next_attempt_at <= ${now})
      ORDER BY scheduled_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    ) AS picked
    WHERE j.id = picked.id
    RETURNING j.id
  `);
  const ids = (result.rows as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return [];
  return getDb().select().from(agentJobs).where(inArray(agentJobs.id, ids));
}

/** Re-arm jobs stuck in 'running' (worker crash mid-processing). */
export async function recoverStuckAgentJobs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_MS);
  const rows = await getDb()
    .update(agentJobs)
    .set({ status: 'pending', updatedAt: now })
    .where(and(eq(agentJobs.status, 'running'), lt(agentJobs.updatedAt, cutoff)))
    .returning({ id: agentJobs.id });
  return rows.length;
}

async function markOutcomeFailed(job: AgentJobRow): Promise<void> {
  if (job.jobType !== 'outcome.refresh') return;
  if (!('outcomeId' in job.payload)) return;
  await getDb()
    .update(outcomes)
    .set({ agentState: 'failed' })
    .where(and(eq(outcomes.id, job.payload.outcomeId), eq(outcomes.userId, job.userId)));
}

async function processOne(job: AgentJobRow, now: Date): Promise<void> {
  const db = getDb();
  try {
    // Dynamic import: keeps jobs.ts a leaf for tasks.service (no static cycle
    // through processors → outcomes.service → tasks.service).
    const { processAgentJob } = await import('./processors.js');
    const result = await processAgentJob(job, now);
    await db
      .update(agentJobs)
      .set({
        status: 'done',
        attemptCount: job.attemptCount + 1,
        lastError: result === 'done' ? null : result,
        updatedAt: now,
      })
      .where(eq(agentJobs.id, job.id));
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const attempts = job.attemptCount + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await db
        .update(agentJobs)
        .set({ status: 'failed', attemptCount: attempts, lastError: message, updatedAt: now })
        .where(eq(agentJobs.id, job.id));
      await markOutcomeFailed(job);
      return;
    }
    const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 30_000;
    await db
      .update(agentJobs)
      .set({
        status: 'pending',
        attemptCount: attempts,
        nextAttemptAt: new Date(now.getTime() + wait),
        lastError: message,
        updatedAt: now,
      })
      .where(eq(agentJobs.id, job.id));
  }
}

export async function processDueAgentJobs(now = new Date()): Promise<number> {
  if (!config.AGENT_ENABLED) return 0;
  const claimed = await claimDueJobs(now, config.WORKER_CLAIM_LIMIT);
  for (const job of claimed) {
    try {
      await processOne(job, now);
    } catch (err) {
      // processOne already handles job-level errors; this guards its own crashes.
      logger.error('agent.job.crash', err);
      await getDb()
        .update(agentJobs)
        .set({
          status: 'pending',
          attemptCount: job.attemptCount + 1,
          nextAttemptAt: new Date(now.getTime() + 30_000),
          lastError: 'process crash',
          updatedAt: now,
        })
        .where(eq(agentJobs.id, job.id));
    }
  }
  return claimed.length;
}
