import { overlapsPauseRanges } from './clock.js';
import { assignEvidence, progressByOpportunity } from './evidence.js';
import { planOpportunities } from './opportunities.js';
import { evaluateStall, judgementOf } from './stall.js';
import type { Opportunity, RecomputeInput, RecomputeResult } from './types.js';

export function recompute(input: RecomputeInput): RecomputeResult {
  const planned = planOpportunities({
    revision: input.revision,
    existing: input.existing,
    pauseRanges: input.pauseRanges,
    now: input.now,
    horizonEnd: input.horizonEnd,
  });
  const links = assignEvidence({
    opportunities: planned,
    evidence: input.evidence,
    now: input.now,
  });
  const progress = progressByOpportunity(links, input.evidence);
  const opportunities = planned.map((row) =>
    resolveStatus(row, progress.get(row.id) ?? 0, input),
  );
  const stall = evaluateStall({
    opportunities,
    now: input.now,
    revision: input.revision.revision,
    cadenceKind: input.revision.cadence.kind,
  });
  const current = opportunities.filter((row) => row.revision === input.revision.revision);
  return {
    opportunities,
    links,
    judgement: judgementOf(stall, input.pauseRanges, input.now, current),
    stall,
  };
}

function resolveStatus(row: Opportunity, progress: number, input: RecomputeInput): Opportunity {
  const { now, revision, pauseRanges } = input;
  if (row.revision !== revision.revision) {
    if (row.startsAt.getTime() > now.getTime()) {
      return row.status === 'canceled' ? row : { ...row, status: 'canceled', updatedAt: now };
    }
    if (progress >= row.targetCount && row.status !== 'canceled') {
      return { ...row, status: 'met', exemptReason: null, updatedAt: now };
    }
    return row;
  }

  if (progress >= row.targetCount) {
    return { ...row, status: 'met', exemptReason: null, updatedAt: now };
  }
  if (overlapsPauseRanges(row.startsAt, row.checkAt, pauseRanges)) {
    return { ...row, status: 'exempt', exemptReason: 'paused', updatedAt: now };
  }
  if (row.observeOnly && now.getTime() >= row.checkAt.getTime()) {
    return { ...row, status: 'exempt', exemptReason: 'observe_only', updatedAt: now };
  }
  if (now.getTime() < row.startsAt.getTime()) {
    return { ...row, status: 'scheduled', exemptReason: null, updatedAt: now };
  }
  if (now.getTime() < row.checkAt.getTime()) {
    return { ...row, status: 'open', exemptReason: null, updatedAt: now };
  }
  return { ...row, status: 'missed', exemptReason: null, updatedAt: now };
}
