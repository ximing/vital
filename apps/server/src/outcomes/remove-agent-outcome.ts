import { and, eq, inArray, ne } from 'drizzle-orm';
import type { AgentDb } from '../agent/jobs.js';
import { purgeContinuityForOutcome } from '../continuity/purge.js';
import { agentActions, habits, inboxItems, outcomes, tasks } from '../db/schema.js';

/**
 * Hard-delete an agent-created thread and unlink its tasks, materials, and habits.
 * Pending proposals on the thread are dismissed, except the action the caller is
 * settling in this same transaction. Headline and suggestion rows are marked
 * superseded: removing the thread is not a decision about that wording.
 * Returns false when the row is missing or the user created it.
 */
export async function removeAgentOutcome(
  tx: AgentDb,
  userId: string,
  outcomeId: string,
  now: Date,
  exceptActionId?: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: outcomes.id, createdBy: outcomes.createdBy })
    .from(outcomes)
    .where(and(eq(outcomes.id, outcomeId), eq(outcomes.userId, userId)))
    .limit(1)
    .for('update');
  if (!row || row.createdBy !== 'agent') return false;

  await tx
    .update(tasks)
    .set({ outcomeId: null })
    .where(and(eq(tasks.userId, userId), eq(tasks.outcomeId, outcomeId)));
  await tx
    .update(inboxItems)
    .set({ outcomeId: null })
    .where(and(eq(inboxItems.userId, userId), eq(inboxItems.outcomeId, outcomeId)));
  await tx
    .update(habits)
    .set({ outcomeId: null, updatedAt: now })
    .where(and(eq(habits.userId, userId), eq(habits.outcomeId, outcomeId)));
  const pendingOnThread = [
    eq(agentActions.userId, userId),
    eq(agentActions.targetType, 'outcome'),
    eq(agentActions.targetId, outcomeId),
    eq(agentActions.feedback, 'pending'),
    exceptActionId !== undefined ? ne(agentActions.id, exceptActionId) : undefined,
  ];
  await tx
    .update(agentActions)
    .set({
      feedback: 'dismissed',
      feedbackAt: now,
      feedbackPayload: { superseded: true },
    })
    .where(
      and(
        ...pendingOnThread,
        inArray(agentActions.actionType, ['outcome.headline', 'outcome.suggestion']),
      ),
    );
  await tx
    .update(agentActions)
    .set({ feedback: 'dismissed', feedbackAt: now })
    .where(and(...pendingOnThread));
  await purgeContinuityForOutcome(tx, userId, outcomeId);
  await tx.delete(outcomes).where(and(eq(outcomes.id, outcomeId), eq(outcomes.userId, userId)));
  return true;
}
