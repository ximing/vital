import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Outcome, OutcomeSignal } from '@vital/dto';
import { getDb } from '../db/index.js';
import { inboxItems, type OutcomeRow } from '../db/schema.js';

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export function asSignal(value: string | null): OutcomeSignal | null {
  return value === 'up' || value === 'flat' || value === 'alert' ? value : null;
}

export interface OutcomeStats {
  openTaskCount: number;
  completedLast7d: number;
  materialCount: number;
  milestoneDone: number;
  milestoneTotal: number;
}

export function emptyOutcomeStats(): OutcomeStats {
  return {
    openTaskCount: 0,
    completedLast7d: 0,
    materialCount: 0,
    milestoneDone: 0,
    milestoneTotal: 0,
  };
}

export function toOutcomeDto(row: OutcomeRow, stats: OutcomeStats = emptyOutcomeStats()): Outcome {
  return {
    id: row.id,
    name: row.name,
    status: row.status === 'closed' ? 'closed' : 'open',
    createdBy: row.createdBy === 'agent' ? 'agent' : 'user',
    ruleSignal: asSignal(row.ruleSignal),
    ruleNextStep: row.ruleNextStep,
    agentHeadline: row.agentHeadline,
    agentSuggestion: row.agentSuggestion,
    agentState:
      row.agentState === 'pending' || row.agentState === 'failed' ? row.agentState : 'idle',
    agentUpdatedAt: iso(row.agentUpdatedAt),
    undoUntil: iso(row.undoUntil),
    lastActivityAt: iso(row.lastActivityAt),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    openTaskCount: stats.openTaskCount,
    completedLast7d: stats.completedLast7d,
    materialCount: stats.materialCount,
    milestoneDone: stats.milestoneDone,
    milestoneTotal: stats.milestoneTotal,
  };
}

export async function loadMaterialCounts(
  userId: string,
  outcomeIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const id of outcomeIds) map.set(id, 0);
  if (outcomeIds.length === 0) return map;
  const materialRows = await getDb()
    .select({ outcomeId: inboxItems.outcomeId, n: sql<number>`count(*)::int` })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        inArray(inboxItems.outcomeId, outcomeIds),
        isNull(inboxItems.deletedAt),
        ne(inboxItems.status, 'converted'),
      ),
    )
    .groupBy(inboxItems.outcomeId);
  for (const row of materialRows) {
    if (row.outcomeId) map.set(row.outcomeId, row.n);
  }
  return map;
}
