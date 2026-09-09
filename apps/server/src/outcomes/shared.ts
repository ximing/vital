import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { outcomes, type OutcomeRow } from '../db/schema.js';
import { AppError } from '../errors.js';

/** Leaf module — no imports from feature services, safe to use anywhere. */
export async function getOwnedOutcomeOr404(userId: string, id: string): Promise<OutcomeRow> {
  const [row] = await getDb().select().from(outcomes).where(eq(outcomes.id, id)).limit(1);
  if (!row || row.userId !== userId) throw AppError.of(404, 'NOT_FOUND');
  return row;
}

export async function assertOwnedOutcomeId(userId: string, outcomeId: string): Promise<void> {
  await getOwnedOutcomeOr404(userId, outcomeId);
}
