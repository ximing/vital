import { and, eq, isNull, lt, ne, or } from 'drizzle-orm';
import { outcomes, type AgentJobRow, type User } from '../db/schema.js';
import { executionResult } from './executions.service.js';
import { enqueueOutcomeRefresh } from './jobs.js';
import { withAgentJobEffects } from './job-runtime.js';
import type { AgentJobResult } from './processors.js';

/** Outcomes whose agent fields are older than this get re-run by reflect.daily. */
const REFRESH_STALE_MS = 24 * 3600 * 1000;

/** Rule-only: fan out refreshes for stale threads + cluster when the pile is big. */
export async function processReflectDaily(
  job: AgentJobRow,
  user: User,
  now: Date,
): Promise<AgentJobResult> {
  await withAgentJobEffects(job, async (db) => {
  const staleBefore = new Date(now.getTime() - REFRESH_STALE_MS);
  const stale = await db
    .select({ id: outcomes.id })
    .from(outcomes)
    .where(
      and(
        eq(outcomes.userId, user.id),
        eq(outcomes.status, 'open'),
        ne(outcomes.agentState, 'pending'),
        or(isNull(outcomes.agentUpdatedAt), lt(outcomes.agentUpdatedAt, staleBefore)),
      ),
    )
    .limit(20);
  for (const row of stale) {
    await enqueueOutcomeRefresh(db, user.id, row.id, now);
  }
  executionResult({ resultSummary: `已安排更新 ${String(stale.length)} 个线程`, inputSummary: '仅检查当前用户的开放线程' });

  });
  return 'done';
}
