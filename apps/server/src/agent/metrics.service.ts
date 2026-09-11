import { and, asc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { AgentAdoptionDaily, AgentCapabilityCost, AgentMetricsResponse } from '@vital/dto';
import { getDb } from '../db/index.js';
import { agentActions, agentUsage } from '../db/schema.js';
import { CAPABILITY_ACTION_MAP, capabilityOfActionType, type CostCapability } from './eval/capability-map.js';

/** adopted / (adopted + dismissed) — pending has no verdict and never counts in the denominator. */
function adoptionRate(adopted: number, dismissed: number): number {
  const decided = adopted + dismissed;
  return decided === 0 ? 0 : adopted / decided;
}

/**
 * Day-bucketed adoption counts over [since, until). Same aggregation convention
 * as dailyUsage: buckets are (timezone(tz, created_at))::date; `until` omitted
 * means "to now" (the current window).
 */
async function windowDaily(
  userId: string,
  timezone: string,
  since: Date,
  until?: Date,
): Promise<AgentAdoptionDaily[]> {
  const db = getDb();
  const filters: SQL[] = [
    eq(agentActions.userId, userId),
    gte(agentActions.createdAt, since),
    sql`${agentActions.actionType} <> 'task.parse'`,
  ];
  if (until !== undefined) filters.push(lt(agentActions.createdAt, until));

  const scoped = db
    .select({
      date: sql<string>`(timezone(${timezone}, ${agentActions.createdAt}))::date`.as('date'),
      feedback: agentActions.feedback,
    })
    .from(agentActions)
    .where(and(...filters))
    .as('scoped');

  const rows = await db
    .select({
      date: scoped.date,
      proposed: sql<number>`count(*)::int`,
      adopted: sql<number>`(count(*) filter (where ${scoped.feedback} in ('accepted', 'edited')))::int`,
      dismissed: sql<number>`(count(*) filter (where ${scoped.feedback} = 'dismissed'))::int`,
      undone: sql<number>`(count(*) filter (where ${scoped.feedback} = 'undone'))::int`,
    })
    .from(scoped)
    .groupBy(scoped.date)
    .orderBy(asc(scoped.date));

  return rows.map((row) => ({
    date: row.date,
    proposed: row.proposed,
    adopted: row.adopted,
    dismissed: row.dismissed,
    undone: row.undone,
    adoptionRate: adoptionRate(row.adopted, row.dismissed),
  }));
}

/**
 * Amortized cost per proposal-producing capability over [since, now) — the same
 * window convention as windowDaily: `since` is a timezone-aligned day boundary.
 * Capabilities without a proposal mapping (critic, distill, …) never appear:
 * their cost has no adoption denominator. A capability shows up when it has
 * usage rows or mapped actions in the window, so adopted-without-cost (legacy
 * data) is still visible.
 */
async function capabilityCosts(
  userId: string,
  since: Date,
): Promise<AgentCapabilityCost[]> {
  const db = getDb();
  const mappedCapabilities = Object.keys(CAPABILITY_ACTION_MAP);
  const mappedActionTypes = Object.values(CAPABILITY_ACTION_MAP).flat() as string[];

  const [actionRows, usageRows] = await Promise.all([
    db
      .select({
        actionType: agentActions.actionType,
        proposed: sql<number>`count(*)::int`,
        adopted: sql<number>`(count(*) filter (where ${agentActions.feedback} in ('accepted', 'edited')))::int`,
      })
      .from(agentActions)
      .where(
        and(
          eq(agentActions.userId, userId),
          gte(agentActions.createdAt, since),
          inArray(agentActions.actionType, mappedActionTypes),
        ),
      )
      .groupBy(agentActions.actionType),
    db
      .select({
        capability: agentUsage.capability,
        runs: sql<number>`count(*)::int`,
        costMicros: sql<number>`coalesce(sum(${agentUsage.costMicros}), 0)::bigint`,
      })
      .from(agentUsage)
      .where(
        and(
          eq(agentUsage.userId, userId),
          gte(agentUsage.createdAt, since),
          inArray(agentUsage.capability, mappedCapabilities),
        ),
      )
      .groupBy(agentUsage.capability),
  ]);

  const proposedBy = new Map<CostCapability, number>();
  const adoptedBy = new Map<CostCapability, number>();
  for (const row of actionRows) {
    const capability = capabilityOfActionType(row.actionType);
    if (!capability) continue;
    proposedBy.set(capability, (proposedBy.get(capability) ?? 0) + row.proposed);
    adoptedBy.set(capability, (adoptedBy.get(capability) ?? 0) + row.adopted);
  }
  const runsBy = new Map(usageRows.map((row) => [row.capability, row.runs]));
  const costBy = new Map(
    usageRows.map((row) => [row.capability, Number.parseInt(String(row.costMicros), 10)]),
  );

  const perCapability: AgentCapabilityCost[] = [];
  for (const capability of mappedCapabilities as CostCapability[]) {
    const hasUsage = (runsBy.get(capability) ?? 0) > 0;
    const hasActions = (proposedBy.get(capability) ?? 0) > 0;
    if (!hasUsage && !hasActions) continue;
    const costMicros = costBy.get(capability) ?? 0;
    const adopted = adoptedBy.get(capability) ?? 0;
    perCapability.push({
      capability,
      costMicros,
      adopted,
      costPerAdoptedMicros: adopted === 0 ? null : costMicros / adopted,
    });
  }
  return perCapability;
}

/**
 * Adoption metrics for the last `days` days plus the preceding window of the same
 * length, so the client can render a trend (current vs prev adoptionRate).
 */
export async function agentAdoptionDaily(
  userId: string,
  days: number,
  timezone: string,
): Promise<AgentMetricsResponse> {
  const now = DateTime.now().setZone(timezone);
  const since = now.minus({ days }).startOf('day').toJSDate();
  const prevSince = now
    .minus({ days: days * 2 })
    .startOf('day')
    .toJSDate();

  const [daily, prev, perCapability] = await Promise.all([
    windowDaily(userId, timezone, since),
    windowDaily(userId, timezone, prevSince, since),
    capabilityCosts(userId, since),
  ]);

  const sum = (
    rows: AgentAdoptionDaily[],
    key: 'proposed' | 'adopted' | 'dismissed' | 'undone',
  ) => rows.reduce((acc, row) => acc + row[key], 0);

  const proposed = sum(daily, 'proposed');
  const adopted = sum(daily, 'adopted');
  const dismissed = sum(daily, 'dismissed');
  return {
    daily,
    summary: {
      proposed,
      adopted,
      dismissed,
      undone: sum(daily, 'undone'),
      adoptionRate: adoptionRate(adopted, dismissed),
      prevAdoptionRate: adoptionRate(sum(prev, 'adopted'), sum(prev, 'dismissed')),
      perCapability,
    },
  };
}
