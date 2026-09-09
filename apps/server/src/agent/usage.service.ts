import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { AgentUsageDaily, AgentUsageSummary } from '@vital/dto';
import { getDb } from '../db/index.js';
import { agentUsage } from '../db/schema.js';
import type { LlmRunUsage } from '../llm/pi.js';

type DbOrTx = Pick<ReturnType<typeof getDb>, 'insert'>;

/** One row per LLM run. Cost comes from pi's usage (catalog rates; 0 for unknown models). */
export async function recordUsage(
  tx: DbOrTx,
  input: {
    userId: string;
    jobId: string;
    capability: string;
    model: string;
    usage: LlmRunUsage;
  },
): Promise<void> {
  await tx.insert(agentUsage).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    jobId: input.jobId,
    capability: input.capability,
    model: input.model,
    promptTokens: input.usage.promptTokens,
    completionTokens: input.usage.completionTokens,
    costMicros: input.usage.costMicros,
  });
}

/** Daily × capability aggregation over the last N days, in the user's timezone. */
export async function dailyUsage(
  userId: string,
  days: number,
  timezone: string,
): Promise<AgentUsageSummary> {
  const since = DateTime.now().setZone(timezone).minus({ days }).startOf('day').toJSDate();
  const db = getDb();
  const scoped = db
    .select({
      date: sql<string>`(timezone(${timezone}, ${agentUsage.createdAt}))::date`.as('date'),
      capability: agentUsage.capability,
      promptTokens: agentUsage.promptTokens,
      completionTokens: agentUsage.completionTokens,
      costMicros: agentUsage.costMicros,
    })
    .from(agentUsage)
    .where(and(eq(agentUsage.userId, userId), gte(agentUsage.createdAt, since)))
    .as('scoped');
  const rows = await db
    .select({
      date: scoped.date,
      capability: scoped.capability,
      runs: sql<number>`count(*)::int`,
      promptTokens: sql<number>`coalesce(sum(${scoped.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${scoped.completionTokens}), 0)::int`,
      costMicros: sql<number>`coalesce(sum(${scoped.costMicros}), 0)::bigint`,
    })
    .from(scoped)
    .groupBy(scoped.date, scoped.capability)
    .orderBy(asc(scoped.date), asc(scoped.capability));

  const items: AgentUsageDaily[] = rows.map((row) => ({
    date: row.date,
    capability: row.capability,
    runs: row.runs,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    costMicros: Number.parseInt(String(row.costMicros), 10),
  }));
  return {
    days,
    totalRuns: items.reduce((acc, item) => acc + item.runs, 0),
    totalPromptTokens: items.reduce((acc, item) => acc + item.promptTokens, 0),
    totalCompletionTokens: items.reduce((acc, item) => acc + item.completionTokens, 0),
    totalCostMicros: items.reduce((acc, item) => acc + item.costMicros, 0),
    items,
  };
}
