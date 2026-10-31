import { and, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { enqueueAgentJob, enqueueAgentJobOnce, type AgentDb } from '../agent/jobs.js';
import { getDb } from '../db/index.js';
import { continuityContracts } from '../db/schema.js';

export const CONTINUITY_RECOMPUTE_JOB_TYPE = 'continuity.recompute';

export function continuityRecomputeDedupKey(contractId: string): string {
  return `continuity.recompute:${contractId}`;
}

export function continuityModelEvalDedupKey(contractId: string, localYmd: string): string {
  return `continuity.model:${contractId}:${localYmd}`;
}

export async function enqueueContinuityRecompute(
  db: AgentDb,
  userId: string,
  contractId: string,
  now: Date,
  trigger: 'event' | 'schedule' = 'event',
): Promise<string | null> {
  return enqueueAgentJob(db, {
    userId,
    jobType: CONTINUITY_RECOMPUTE_JOB_TYPE,
    payload: { contractId, trigger },
    dedupKey: continuityRecomputeDedupKey(contractId),
    scheduledAt: now,
  });
}

/**
 * Atomically occupy the per-contract per-local-day model slot.
 * T3 does not call a model; T4/T5 use this before any eval.
 */
export async function tryReserveDailyModelEval(
  db: AgentDb,
  userId: string,
  contractId: string,
  localYmd: string,
  now: Date,
): Promise<boolean> {
  const id = await enqueueAgentJobOnce(db, {
    userId,
    jobType: CONTINUITY_RECOMPUTE_JOB_TYPE,
    payload: { contractId, trigger: 'model' },
    dedupKey: continuityModelEvalDedupKey(contractId, localYmd),
    scheduledAt: now,
  });
  return id !== null;
}

export async function enqueueUserContinuityRecomputes(
  db: AgentDb,
  userId: string,
  now: Date,
): Promise<number> {
  const rows = await db
    .select({ id: continuityContracts.id })
    .from(continuityContracts)
    .where(
      and(
        eq(continuityContracts.userId, userId),
        inArray(continuityContracts.lifecycle, ['active', 'paused']),
      ),
    );
  let n = 0;
  for (const row of rows) {
    const id = await enqueueContinuityRecompute(db, userId, row.id, now);
    if (id) n += 1;
  }
  return n;
}

/** Catch-up: due next_check_at, or active with no check scheduled yet. Not gated on user activity. */
export async function enqueueDueContinuityRecomputes(now = new Date()): Promise<number> {
  const db = getDb();
  const due = await db
    .select({ id: continuityContracts.id, userId: continuityContracts.userId })
    .from(continuityContracts)
    .where(
      or(
        and(
          inArray(continuityContracts.lifecycle, ['active', 'paused']),
          isNotNull(continuityContracts.nextCheckAt),
          lte(continuityContracts.nextCheckAt, now),
        ),
        and(eq(continuityContracts.lifecycle, 'active'), isNull(continuityContracts.nextCheckAt)),
      ),
    )
    .limit(200);
  let n = 0;
  for (const row of due) {
    const id = await enqueueContinuityRecompute(db, row.userId, row.id, now, 'schedule');
    if (id) n += 1;
  }
  return n;
}
