import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { AgentExecution } from '@vital/dto';
import { getDb } from '../db/index.js';
import { agentExecutions, agentActions } from '../db/schema.js';
import { summarizePayload } from './actions.service.js';
import { AppError } from '../errors.js';
import { logger } from '../utils/logger.js';

interface ExecutionContext {
  id: string;
  userId: string;
  jobId: string | null;
  attempt: number;
  skipped: string | null;
  result: { targetType?: string; targetId?: string; resultSummary?: string };
}
const storage = new AsyncLocalStorage<ExecutionContext>();

export function executionContext(): ExecutionContext | undefined {
  return storage.getStore();
}

/** Persist only a stable code. Provider messages can contain URLs, credentials or prompt data. */
export function telemetryErrorCode(error: unknown): string {
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
  if (parent && parent.userId !== input.userId) throw new Error('execution user mismatch');
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
    ...context.result, createdAt: startedAt,
  });
  return storage.run(context, async () => {
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
      status = 'failed';
      reason = telemetryErrorCode(error);
      throw error;
    } finally {
      const finishedAt = new Date();
      try {
        await getDb().update(agentExecutions).set({
          status, reason, ...context.result, finishedAt,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
        }).where(eq(agentExecutions.id, id));
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
  const rows = await getDb().update(agentExecutions).set({
    status: 'failed', reason: 'PROCESS_INTERRUPTED', finishedAt: new Date(),
  }).where(and(eq(agentExecutions.status, 'running'), lt(agentExecutions.createdAt, cutoff))).returning({ id: agentExecutions.id });
  return rows.length;
}
