import type { Database } from '../db/index.js';
import { agentActions, type NewAgentAction } from '../db/schema.js';
import { executionContext } from './executions.service.js';

/** Domain proposals keep feedback semantics and are linked to their producing execution. */
export async function recordAgentAction(
  tx: Pick<Database, 'insert'>,
  input: NewAgentAction,
): Promise<void> {
  const context = executionContext();
  if (context && input.userId !== context.userId) throw new Error('action user mismatch');
  await tx.insert(agentActions).values({ ...input, executionId: context?.id ?? null });
}
