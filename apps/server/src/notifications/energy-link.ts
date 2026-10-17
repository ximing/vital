/**
 * Energy on day D versus completion rate on D+1.
 * Low energy is 1–2. A day counts only when the next day has a denominator
 * (non-habit completions + still-open non-habit tasks due that next day).
 * Fewer than two days in either group, or a drop under 15 points, is not a conclusion.
 */
export const ENERGY_LOW_MAX = 2;
export const ENERGY_LINK_MIN_PER_GROUP = 2;
export const ENERGY_LINK_MIN_DROP_POINTS = 15;

export interface EnergyDayLink {
  /** Local day of the energy reading. */
  day: string;
  /** Lowest energy logged that day (a single low reading marks the day). */
  energy: number;
  nextCompleted: number;
  nextDueOpen: number;
}

export interface EnergyLinkConclusion {
  lowDays: number;
  otherDays: number;
  lowPercent: number;
  otherPercent: number;
  dropPoints: number;
}

function dayRate(day: EnergyDayLink): number | null {
  const denom = day.nextCompleted + day.nextDueOpen;
  if (denom <= 0) return null;
  return day.nextCompleted / denom;
}

function meanPercent(rates: readonly number[]): number {
  const sum = rates.reduce((total, rate) => total + rate, 0);
  return Math.round((sum / rates.length) * 100);
}

/** Null when the week cannot support a claim. Does not call a model. */
export function energyCompletionLink(days: readonly EnergyDayLink[]): EnergyLinkConclusion | null {
  const low: number[] = [];
  const other: number[] = [];
  for (const day of days) {
    if (!Number.isInteger(day.energy) || day.energy < 1 || day.energy > 5) continue;
    const rate = dayRate(day);
    if (rate === null) continue;
    if (day.energy <= ENERGY_LOW_MAX) low.push(rate);
    else other.push(rate);
  }
  if (low.length < ENERGY_LINK_MIN_PER_GROUP || other.length < ENERGY_LINK_MIN_PER_GROUP) return null;
  const lowPercent = meanPercent(low);
  const otherPercent = meanPercent(other);
  const dropPoints = otherPercent - lowPercent;
  if (dropPoints < ENERGY_LINK_MIN_DROP_POINTS) return null;
  return {
    lowDays: low.length,
    otherDays: other.length,
    lowPercent,
    otherPercent,
    dropPoints,
  };
}

export function energyLinkSentence(link: EnergyLinkConclusion): string {
  return `精力 ≤ ${String(ENERGY_LOW_MAX)} 的次日完成率约 ${String(link.lowPercent)}%，比其他日子低 ${String(link.dropPoints)} 个百分点（低精力 ${String(link.lowDays)} 天，其他 ${String(link.otherDays)} 天）。`;
}

/** Energy takes the slot after a late-night pattern and inside the two-pattern cap. */
export function preferEnergyPattern<T extends { kind: string }>(
  patterns: readonly T[],
  energy: T | null,
  cap = 2,
): T[] {
  if (!energy) return patterns.slice(0, cap);
  const rest = patterns.filter((pattern) => pattern.kind !== 'energy');
  const late = rest.filter((pattern) => pattern.kind === 'late_night');
  const others = rest.filter((pattern) => pattern.kind !== 'late_night');
  return [...late, energy, ...others].slice(0, cap);
}
