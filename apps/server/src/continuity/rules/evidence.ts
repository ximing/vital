import { randomUUID } from 'node:crypto';
import { ymdInTimeZone } from '@vital/dto';
import type { AssignEvidenceInput, Evidence, EvidenceLink, Opportunity } from './types.js';

export function evidenceSourceKey(row: Evidence): string | null {
  if (row.sourceId === null || row.sourceId === '') return null;
  return `${row.sourceType}:${row.sourceId}:${String(row.sourceRevision ?? 0)}`;
}

export function supersededIdsOf(evidence: readonly Evidence[]): Set<string> {
  const ids = new Set<string>();
  for (const row of evidence) {
    if (row.supersedesId) ids.add(row.supersedesId);
  }
  return ids;
}

export function isProgressEvidence(row: Evidence, supersededIds: Set<string>): boolean {
  if (row.retractedAt) return false;
  if (supersededIds.has(row.id)) return false;
  if (row.sourceType === 'agent_prep') return false;
  if (row.sourceType === 'self_report' || row.sourceType === 'user_confirm') return true;
  return row.actor === 'user';
}

export function assignEvidence(input: AssignEvidenceInput): EvidenceLink[] {
  const superseded = supersededIdsOf(input.evidence);
  const usable = input.evidence
    .filter((row) => isProgressEvidence(row, superseded))
    .slice()
    .sort(compareEvidence);
  const opps = input.opportunities.filter((row) => row.status !== 'canceled');
  const timedUsed = new Set<string>();
  const assigned = new Set<string>();
  const links: EvidenceLink[] = [];

  const tryLink = (row: Evidence, opp: Opportunity): boolean => {
    if (assigned.has(row.id)) return false;
    if (opp.kind === 'timed') {
      const key = evidenceSourceKey(row);
      if (key && timedUsed.has(key)) return false;
      if (key) timedUsed.add(key);
    }
    assigned.add(row.id);
    links.push(makeLink(row, opp, input.now));
    return true;
  };

  for (const row of usable) {
    const bound = boundOpportunity(row, opps);
    if (bound) tryLink(row, bound);
  }

  for (const row of usable) {
    if (assigned.has(row.id)) continue;
    const timedHits = opps.filter((opp) => timedContains(opp, row.occurredAt));
    if (timedHits.length > 1) continue;
    if (timedHits.length === 1) {
      const only = timedHits[0];
      if (only) tryLink(row, only);
      continue;
    }
    const weekHit = pickWeeklyOpportunity(opps, row.occurredAt);
    if (weekHit) tryLink(row, weekHit);
  }

  return links;
}

export function progressByOpportunity(
  links: readonly EvidenceLink[],
  evidence: readonly Evidence[],
): Map<string, number> {
  const byId = new Map(evidence.map((row) => [row.id, row]));
  const seen = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const link of links) {
    if (!link.meetsCriteria || !link.opportunityId) continue;
    const row = byId.get(link.evidenceId);
    if (!row) continue;
    const unit = evidenceSourceKey(row) ?? row.id;
    let used = seen.get(link.opportunityId);
    if (!used) {
      used = new Set();
      seen.set(link.opportunityId, used);
    }
    if (used.has(unit)) continue;
    used.add(unit);
    counts.set(link.opportunityId, (counts.get(link.opportunityId) ?? 0) + 1);
  }
  return counts;
}

function timedContains(opp: Opportunity, occurredAt: Date): boolean {
  if (opp.kind !== 'timed') return false;
  const t = occurredAt.getTime();
  return t >= opp.startsAt.getTime() && t <= opp.checkAt.getTime();
}

function weekContains(opp: Opportunity, occurredAt: Date): boolean {
  if (opp.kind !== 'weekly_count') return false;
  const ymd = ymdInTimeZone(occurredAt, opp.timezoneSnapshot);
  return ymd >= opp.localStartDate && ymd <= opp.localEndDate;
}

/** Historical snapshot wins when a timezone change creates a second overlapping week. */
function pickWeeklyOpportunity(opps: readonly Opportunity[], occurredAt: Date): Opportunity | undefined {
  const hits = opps.filter((opp) => weekContains(opp, occurredAt));
  if (hits.length === 0) return undefined;
  if (hits.length === 1) return hits[0];
  const t = occurredAt.getTime();
  const contained = hits.filter(
    (opp) => t >= opp.startsAt.getTime() && t < opp.endsAt.getTime(),
  );
  const pool = contained.length > 0 ? contained : hits;
  return pool.slice().sort((a, b) => {
    if (a.revision !== b.revision) return a.revision - b.revision;
    return a.startsAt.getTime() - b.startsAt.getTime();
  })[0];
}

function boundOpportunity(row: Evidence, opps: readonly Opportunity[]): Opportunity | undefined {
  const id = explicitOpportunityId(row);
  if (id) return opps.find((opp) => opp.id === id);
  const windowKey = row.body.windowKey;
  if (typeof windowKey === 'string' && windowKey.length > 0) {
    return opps.find((opp) => opp.windowKey === windowKey);
  }
  return undefined;
}

function explicitOpportunityId(row: Evidence): string | null {
  if (row.opportunityId) return row.opportunityId;
  const fromBody = row.body.opportunityId;
  return typeof fromBody === 'string' && fromBody.length > 0 ? fromBody : null;
}

function makeLink(row: Evidence, opp: Opportunity, now: Date): EvidenceLink {
  return {
    id: randomUUID(),
    userId: row.userId ?? opp.userId,
    evidenceId: row.id,
    contractId: opp.contractId,
    opportunityId: opp.id,
    meetsCriteria: true,
    rationale: null,
    createdAt: now,
  };
}

function compareEvidence(a: Evidence, b: Evidence): number {
  const byOccurred = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (byOccurred !== 0) return byOccurred;
  const byRecorded = a.recordedAt.getTime() - b.recordedAt.getTime();
  if (byRecorded !== 0) return byRecorded;
  return a.id.localeCompare(b.id);
}
