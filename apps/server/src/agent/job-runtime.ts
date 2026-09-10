import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, gt } from 'drizzle-orm';
import { config } from '../config.js';
import { getDb, type Database } from '../db/index.js';
import { agentJobs, type AgentJobRow } from '../db/schema.js';
import { lockAgentUser } from './user-lock.js';

export type AgentJobTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const context = new AsyncLocalStorage<AgentJobRow>();
export const currentAgentJob = (): AgentJobRow | undefined => context.getStore();
export function runWithAgentJob<T>(job: AgentJobRow, fn: () => Promise<T>): Promise<T> {
  return context.run(job, fn);
}
export class LostAgentJobLeaseError extends Error {
  constructor() { super('Agent job lease lost'); this.name = 'LostAgentJobLeaseError'; }
}
export class DeferredAgentJobError extends Error {
  constructor(public readonly reason: string, public readonly nextAttemptAt: Date) {
    super(reason); this.name = 'DeferredAgentJobError';
  }
}
export class RetryableAgentJobError extends Error {
  constructor(public readonly reason: string, options?: ErrorOptions) {
    super(reason, options); this.name = 'RetryableAgentJobError';
  }
}

export function ownsAgentJob(job: AgentJobRow, now = new Date()) {
  if (!job.leaseToken || job.claimedGeneration === null) throw new LostAgentJobLeaseError();
  return and(eq(agentJobs.id, job.id), eq(agentJobs.userId, job.userId),
    eq(agentJobs.status, 'running'), eq(agentJobs.leaseToken, job.leaseToken),
    eq(agentJobs.claimedGeneration, job.claimedGeneration), gt(agentJobs.leaseExpiresAt, now));
}

/** All domain writes and their replay receipt must commit in this one transaction. */
export async function withAgentJobEffects<T>(job: AgentJobRow, apply: (tx: AgentJobTransaction) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await lockAgentUser(tx, job.userId);
    const [owned] = await tx.select().from(agentJobs).where(ownsAgentJob(job)).for('update');
    if (!owned) throw new LostAgentJobLeaseError();
    if (owned.appliedGeneration === job.claimedGeneration) return owned.effectResult as T;
    const result = await apply(tx);
    await tx.update(agentJobs).set({ appliedGeneration: job.claimedGeneration, effectResult: result }).where(eq(agentJobs.id, job.id));
    return result;
  });
}

export async function heartbeatAgentJob(job: AgentJobRow, now = new Date()): Promise<boolean> {
  const rows = await getDb().update(agentJobs).set({ leaseExpiresAt: new Date(now.getTime() + config.AGENT_LEASE_MS), updatedAt: now })
    .where(ownsAgentJob(job, now)).returning({ id: agentJobs.id });
  return rows.length > 0;
}

/** Retry only known transport/transient failures; programming errors are terminal. */
export function isRetryableAgentJobError(error: unknown): boolean {
  if (error instanceof RetryableAgentJobError) return true;
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; status?: number; statusCode?: number; cause?: unknown; message?: string };
  if (e.code && ['LLM_UNAVAILABLE', 'LLM_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', '40001', '40P01', '53300', '57P01'].includes(e.code)) return true;
  const status = e.status ?? e.statusCode;
  if (status === 429 || (status !== undefined && status >= 500 && status < 600)) return true;
  return e.cause !== error && isRetryableAgentJobError(e.cause);
}
