import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { AgentUsageDaily, AgentUsageSummary } from '@vital/dto';
import { getDb } from '../db/index.js';
import { agentUsage } from '../db/schema.js';
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
      status: agentUsage.status,
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
      modelRequests: sql<number>`count(*) FILTER (WHERE ${scoped.status} != 'legacy')::int`,
      failedRequests: sql<number>`count(*) FILTER (WHERE ${scoped.status} = 'failed')::int`,
      unknownUsageRequests: sql<number>`count(*) FILTER (WHERE ${scoped.status} != 'legacy' AND ${scoped.promptTokens} IS NULL)::int`,
      unknownCostRequests: sql<number>`count(*) FILTER (WHERE ${scoped.status} != 'legacy' AND ${scoped.costMicros} IS NULL)::int`,
      legacyRuns: sql<number>`count(*) FILTER (WHERE ${scoped.status} = 'legacy')::int`,
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
    modelRequests: rows.reduce((sum, row) => sum + row.modelRequests, 0),
    failedRequests: rows.reduce((sum, row) => sum + row.failedRequests, 0),
    unknownUsageRequests: rows.reduce((sum, row) => sum + row.unknownUsageRequests, 0),
    unknownCostRequests: rows.reduce((sum, row) => sum + row.unknownCostRequests, 0),
    legacyRuns: rows.reduce((sum, row) => sum + row.legacyRuns, 0),
    totalRuns: items.reduce((acc, item) => acc + item.runs, 0),
    totalPromptTokens: items.reduce((acc, item) => acc + item.promptTokens, 0),
    totalCompletionTokens: items.reduce((acc, item) => acc + item.completionTokens, 0),
    totalCostMicros: items.reduce((acc, item) => acc + item.costMicros, 0),
    items,
  };
}
