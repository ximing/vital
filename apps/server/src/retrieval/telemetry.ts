import type { AssistantMessage } from '@earendil-works/pi-ai';
import { beginModelCall } from '../llm/telemetry.js';
import { logger } from '../utils/logger.js';

export interface RetrievalTelemetryOptions {
  /** Required for usage rows; without it the call is not tracked. */
  userId: string | undefined;
  capability: 'agent.embed' | 'agent.rerank';
  model: string;
}

function syntheticUsageMessage(promptTokens: number): AssistantMessage {
  return {
    stopReason: 'stop',
    usage: {
      input: promptTokens,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as unknown as AssistantMessage;
}

/**
 * Best-effort usage accounting for dashscope retrieval calls, reusing the
 * agent_usage pipeline. Never breaks the retrieval call: beginModelCall throws
 * outside an agent execution context (request-scoped indexing), in which case
 * the call simply goes untracked.
 */
export async function withRetrievalTelemetry<T>(
  opts: RetrievalTelemetryOptions,
  run: () => Promise<{ result: T; promptTokens: number }>,
): Promise<T> {
  if (opts.userId === undefined) {
    const { result } = await run();
    return result;
  }
  let finalize: Awaited<ReturnType<typeof beginModelCall>> | null = null;
  try {
    finalize = await beginModelCall({
      userId: opts.userId,
      capability: opts.capability,
      provider: 'dashscope',
      model: opts.model,
      priced: false,
    });
  } catch (err) {
    logger.debug('retrieval.telemetry.unavailable', { err: String(err) });
  }
  try {
    const { result, promptTokens } = await run();
    if (finalize) await finalize(syntheticUsageMessage(promptTokens));
    return result;
  } catch (err) {
    if (finalize) await finalize(undefined, err);
    throw err;
  }
}
