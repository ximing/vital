import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { getDb } from '../db/index.js';
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

type WordingAction = 'outcome.headline' | 'outcome.suggestion';

/**
 * A newer pending headline or suggestion replaces the older wording.
 * Those rows are not a user decision: feedbackPayload.superseded keeps them
 * out of adoption stats and memory.distill.
 */
export async function retireSupersededWording(userId: string): Promise<void> {
  await getDb().execute(sql`
    update agent_actions as older
    set feedback = 'dismissed',
        feedback_at = now(),
        feedback_payload = '{"superseded":true}'::jsonb
    where older.user_id = ${userId}
      and older.feedback = 'pending'
      and older.action_type in ('outcome.headline', 'outcome.suggestion')
      and exists (
        select 1 from agent_actions as newer
        where newer.user_id = older.user_id
          and newer.target_id = older.target_id
          and newer.action_type = older.action_type
          and newer.feedback = 'pending'
          and (newer.created_at, newer.id) > (older.created_at, older.id)
      )
  `);
}

/** Drop older pending wording for one thread inside the job transaction. */
export async function retireOlderPending(
  tx: Pick<Database, 'update'>,
  userId: string,
  targetId: string,
  actionType: WordingAction,
  keepId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(agentActions)
    .set({
      feedback: 'dismissed',
      feedbackAt: now,
      feedbackPayload: { superseded: true },
    })
    .where(
      and(
        eq(agentActions.userId, userId),
        eq(agentActions.targetId, targetId),
        eq(agentActions.actionType, actionType),
        eq(agentActions.feedback, 'pending'),
        sql`${agentActions.id} <> ${keepId}`,
      ),
    );
}
