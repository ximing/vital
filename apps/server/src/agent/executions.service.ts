import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { AgentExecution } from '@vital/dto';
import { getDb } from '../db/index.js';
import { agentExecutions, agentActions } from '../db/schema.js';
import { summarizePayload } from './actions.service.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';
import { currentAgentJob, DeferredAgentJobError, LostAgentJobLeaseError } from './job-runtime.js';

interface ExecutionContext {
  id: string;
  userId: string;
  jobId: string | null;
  attempt: number;
  skipped: string | null;
  result: { targetType?: string; targetId?: string; resultSummary?: string; inputSummary?: string };
}
const storage = new AsyncLocalStorage<ExecutionContext>();

export function executionContext(): ExecutionContext | undefined {
  return storage.getStore();
}

/** Persist only a stable code. Provider messages can contain URLs, credentials or prompt data. */
export function telemetryErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === 'UnknownAgentJobTypeError') return 'UNKNOWN_JOB_TYPE';
  if (error instanceof DeferredAgentJobError) return error.reason;
  if (error instanceof LostAgentJobLeaseError) return 'LEASE_LOST';
  if (error instanceof AppError && /^[A-Z_]{1,80}$/.test(error.code)) return error.code;
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) return 'LLM_TIMEOUT';
  return 'EXECUTION_FAILED';
}

export function skipExecution(reason: string): void {
  const context = storage.getStore();
  if (context) context.skipped = reason;
}

export function executionResult(result: ExecutionContext['result']): void {
  const context = storage.getStore();
  if (context) Object.assign(context.result, result);
}

/** One lifecycle owner, also propagates correlation to every nested model call. */
export async function withExecution<T>(
  input: {
    userId: string;
    capability: string;
    jobId?: string | null;
    attempt?: number;
    targetType?: string;
    targetId?: string;
  },
  work: () => Promise<T>,
): Promise<T> {
  const parent = storage.getStore();
  const job = currentAgentJob();
  if (parent && parent.userId !== input.userId) throw new Error('execution user mismatch');
  if (job && job.userId !== input.userId) throw new Error('execution job user mismatch');
  const id = randomUUID();
  const startedAt = new Date();
  const context: ExecutionContext = {
    id,
    userId: input.userId,
    jobId: input.jobId ?? parent?.jobId ?? null,
    attempt: input.attempt ?? parent?.attempt ?? 1,
    skipped: null,
    result: {
      ...(input.targetType ? { targetType: input.targetType } : {}),
      ...(input.targetId ? { targetId: input.targetId } : {}),
    },
  };
  await getDb().insert(agentExecutions).values({
    id, userId: input.userId, parentId: parent?.id ?? null,
    jobId: context.jobId, capability: input.capability, attempt: context.attempt,
    leaseToken: job?.leaseToken ?? null, jobGeneration: job?.claimedGeneration ?? null,
    trigger: job && 'trigger' in job.payload ? job.payload.trigger : job ? 'scheduled' : 'user_request',
    heartbeatAt: startedAt,
    ...context.result, createdAt: startedAt,
  });
  return storage.run(context, async () => {
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy) return;
      heartbeatBusy = true;
      void getDb().update(agentExecutions).set({ heartbeatAt: new Date() })
        .where(and(eq(agentExecutions.id, id), eq(agentExecutions.status, 'running')))
        .catch((error: unknown) => { logger.error('agent.execution.heartbeat_failed', error); })
        .finally(() => { heartbeatBusy = false; });
    }, 30_000);
    heartbeat.unref();
    let status: AgentExecution['status'] = 'succeeded';
    let reason: string | null = null;
    try {
      const result = await work();
      if (context.skipped) {
        status = 'skipped';
        reason = context.skipped;
      }
      return result;
    } catch (error) {
      status = error instanceof DeferredAgentJobError ? 'skipped' : 'failed';
      reason = telemetryErrorCode(error);
      throw error;
    } finally {
      clearInterval(heartbeat);
      const finishedAt = new Date();
      try {
        await getDb().update(agentExecutions).set({
          status, reason, ...context.result, finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        }).where(and(eq(agentExecutions.id, id), eq(agentExecutions.status, 'running')));
      } catch (error) {
        // Telemetry must never turn a committed business operation into a retry.
        logger.error('agent.execution.finalize_failed', error);
      }
    }
  });
}

export async function listExecutions(userId: string, days: number): Promise<AgentExecution[]> {
  const rows = await getDb().select().from(agentExecutions)
    .where(and(eq(agentExecutions.userId, userId),
      gte(agentExecutions.createdAt, new Date(Date.now() - days * 86400_000))))
    .orderBy(desc(agentExecutions.createdAt), desc(agentExecutions.id)).limit(100);
  const actions = rows.length ? await getDb().select().from(agentActions)
    .where(and(eq(agentActions.userId, userId), inArray(agentActions.executionId, rows.map((row) => row.id)))) : [];
  return rows.map((row) => ({
    ...row,
    resultSummary: row.resultSummary ?? (actions.filter((a) => a.executionId === row.id)
      .map((a) => summarizePayload(a.actionType, a.payload)).filter(Boolean).join('；').slice(0, 500) || null),
    status: row.status as AgentExecution['status'],
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  }));
}

/** Mark executions abandoned with their worker job so restarts don't leave them running forever. */
export async function recoverStuckExecutions(cutoff: Date): Promise<number> {
  const now = new Date();
  return getDb().transaction(async (tx) => {
    const rows = await tx.execute(sql`UPDATE agent_executions e SET
      status = 'failed', reason = 'PROCESS_INTERRUPTED', finished_at = ${now},
      duration_ms = LEAST(2147483647, GREATEST(0, EXTRACT(EPOCH FROM (${now}::timestamptz - e.created_at)) * 1000))::int
      WHERE e.status = 'running' AND e.heartbeat_at < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM agent_jobs j WHERE j.id = e.job_id AND j.status = 'running'
        AND j.lease_token = e.lease_token AND j.lease_expires_at > ${now}) RETURNING e.id`);
    await tx.execute(sql`UPDATE agent_usage u SET status = 'failed', reason = 'PROCESS_INTERRUPTED_USAGE_UNKNOWN',
      finished_at = ${now}, duration_ms = LEAST(2147483647, GREATEST(0, EXTRACT(EPOCH FROM (${now}::timestamptz - u.created_at)) * 1000))::int
      WHERE u.status = 'running' AND u.created_at < ${cutoff}
      AND EXISTS (SELECT 1 FROM agent_executions e WHERE e.id = u.execution_id AND e.status <> 'running')`);
    return rows.rows.length;
  });
}
