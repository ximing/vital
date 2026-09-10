import { randomUUID } from 'node:crypto';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { agentUsage } from '../db/schema.js';
import { executionContext, telemetryErrorCode } from '../agent/executions.service.js';
import { logger } from '../utils/logger.js';

/** Shared owner of individual model request accounting, for both completion and Agent streams. */
export async function beginModelCall(input: {
  userId: string;
  capability: string;
  provider: string;
  model: string;
  priced: boolean;
}) {
  const context = executionContext();
  if (!context || context.userId !== input.userId) throw new Error('model call requires execution context');
  const id = randomUUID();
  const startedAt = new Date();
  await getDb().insert(agentUsage).values({
    id, userId: input.userId, jobId: context.jobId, executionId: context.id,
    capability: input.capability.replace(/^(agent|task)\./, ''),
    provider: input.provider, model: input.model, status: 'running', createdAt: startedAt,
  });
  let settled = false;
  return async (message?: AssistantMessage, error?: unknown): Promise<void> => {
    if (settled) return;
    settled = true;
    const failed = error !== undefined || !message ||
      ['error', 'aborted', 'length'].includes(message.stopReason);
    const usage = message?.usage;
    // pi uses an all-zero usage object when the provider omitted usage.
    const known = !!usage && usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0;
    const finishedAt = new Date();
    try {
      await getDb().update(agentUsage).set({
        status: failed ? 'failed' : 'succeeded',
        reason: error !== undefined ? telemetryErrorCode(error)
          : message?.stopReason === 'aborted' ? 'LLM_TIMEOUT'
          : message?.stopReason === 'length' ? 'LLM_OUTPUT_TRUNCATED'
          : failed ? 'LLM_UNAVAILABLE' : null,
        promptTokens: known ? usage.input + usage.cacheRead + usage.cacheWrite : null,
        completionTokens: known ? usage.output : null,
        costMicros: known && input.priced ? Math.round(usage.cost.total * 1_000_000) : null,
        finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime(),
      }).where(eq(agentUsage.id, id));
    } catch (finalizeError) {
      logger.error('agent.usage.finalize_failed', finalizeError);
    }
  };
}
