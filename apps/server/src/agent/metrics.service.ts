import { and, asc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { AgentAdoptionDaily, AgentMetricsResponse } from '@vital/dto';
import { getDb } from '../db/index.js';
import { agentActions } from '../db/schema.js';

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
  const filters: SQL[] = [eq(agentActions.userId, userId), gte(agentActions.createdAt, since)];
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
    })
    .from(scoped)
    .groupBy(scoped.date)
    .orderBy(asc(scoped.date));

  return rows.map((row) => ({
    date: row.date,
    proposed: row.proposed,
    adopted: row.adopted,
    dismissed: row.dismissed,
    adoptionRate: adoptionRate(row.adopted, row.dismissed),
  }));
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

  const [daily, prev] = await Promise.all([
    windowDaily(userId, timezone, since),
    windowDaily(userId, timezone, prevSince, since),
  ]);

  const sum = (rows: AgentAdoptionDaily[], key: 'proposed' | 'adopted' | 'dismissed') =>
    rows.reduce((acc, row) => acc + row[key], 0);

  const proposed = sum(daily, 'proposed');
  const adopted = sum(daily, 'adopted');
  const dismissed = sum(daily, 'dismissed');
  return {
    daily,
    summary: {
      proposed,
      adopted,
      dismissed,
      adoptionRate: adoptionRate(adopted, dismissed),
      prevAdoptionRate: adoptionRate(sum(prev, 'adopted'), sum(prev, 'dismissed')),
    },
  };
}
