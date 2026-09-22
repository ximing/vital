import { eq, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Database } from '../db/index.js';
import { agentModelBudgets } from '../db/schema/agent-budget.js';
import { users } from '../db/schema/users.js';
import { DeferredAgentJobError } from './job-runtime.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Call inside the same transaction that inserts the model-request ledger row.
 * `limit` overrides the user's saved daily budget; production callers omit it.
 */
export async function reserveBackgroundModelCall(
  tx: Transaction,
  userId: string,
  now = new Date(),
  limit?: number,
): Promise<void> {
  const [user] = await tx
    .select({ timezone: users.timezone, dailyModelCallLimit: users.dailyModelCallLimit })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new Error('model budget user not found');
  const cap = limit ?? user.dailyModelCallLimit;
  const local = DateTime.fromJSDate(now).setZone(user.timezone);
  const day = local.toISODate();
  if (!day) throw new Error('invalid budget timezone');
  const rows = await tx
    .insert(agentModelBudgets)
    .values({ userId, day, requests: 1 })
    .onConflictDoUpdate({
      target: [agentModelBudgets.userId, agentModelBudgets.day],
      set: { requests: sql`${agentModelBudgets.requests} + 1` },
      setWhere: lt(agentModelBudgets.requests, cap),
    })
    .returning({ requests: agentModelBudgets.requests });
  if (!rows.length) {
    throw new DeferredAgentJobError(
      'DAILY_MODEL_BUDGET',
      local.plus({ days: 1 }).startOf('day').toJSDate(),
    );
  }
}
