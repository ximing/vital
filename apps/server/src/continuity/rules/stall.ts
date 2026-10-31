import type { ContinuityJudgement } from '@vital/dto';
import { isPausedAt } from './clock.js';
import { compareOpportunities } from './opportunities.js';
import type { EvaluateStallInput, Opportunity, PauseRange, StallDecision } from './types.js';

const NONE: StallDecision = {
  kind: 'none',
  factRefs: { opportunityIds: [], progressCount: 0, reasonCode: null },
};

function effectiveChecked(input: EvaluateStallInput): Opportunity[] {
  return input.opportunities
    .filter((row) => row.revision === input.revision)
    .filter((row) => row.status !== 'canceled' && row.status !== 'exempt')
    .filter((row) => !row.observeOnly)
    .filter((row) => row.checkAt.getTime() <= input.now.getTime())
    .slice()
    .sort(compareOpportunities);
}

function missedRefs(rows: readonly Opportunity[]): StallDecision {
  return {
    kind: rows.length >= 2 ? 'stall' : 'watching',
    factRefs: {
      opportunityIds: rows.map((row) => row.id),
      progressCount: 0,
      reasonCode: 'no_record',
    },
  };
}

export function evaluateStall(input: EvaluateStallInput): StallDecision {
  const checked = effectiveChecked(input);
  if (input.cadenceKind === 'weekly_count') {
    const last = checked[checked.length - 1];
    if (!last || last.status !== 'missed') return NONE;
    return { ...missedRefs([last]), kind: 'stall' };
  }

  const suffix: Opportunity[] = [];
  for (let i = checked.length - 1; i >= 0; i -= 1) {
    const row = checked[i];
    if (row?.status === 'missed') suffix.push(row);
    else break;
  }
  suffix.reverse();
  if (suffix.length >= 2) return { ...missedRefs(suffix.slice(-2)), kind: 'stall' };
  if (suffix.length === 1) return missedRefs(suffix);
  return NONE;
}

export function judgementOf(
  stall: StallDecision,
  pauseRanges: readonly PauseRange[],
  now: Date,
  currentOpportunities: readonly Opportunity[],
): ContinuityJudgement {
  if (isPausedAt(now, pauseRanges)) return 'waiting';
  if (currentOpportunities.length === 0) return 'waiting';
  if (stall.kind === 'stall') return 'needs_adjust';
  if (stall.kind === 'watching') return 'watching';
  return 'on_track';
}
