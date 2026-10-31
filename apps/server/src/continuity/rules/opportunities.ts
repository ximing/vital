import { randomUUID } from 'node:crypto';
import { addDaysYmd } from '@vital/dto';
import type { ContinuityCadence, ContinuityTimedSlot } from '@vital/dto';
import {
  eachYmd,
  graceHoursOf,
  localYmd,
  overlapsPauseRanges,
  plusHours,
  plusMinutes,
  startOfWeekYmd,
  weekdayOfYmd,
  zonedDateTime,
} from './clock.js';
import type { Opportunity, PlanOpportunitiesInput, RuleRevision } from './types.js';

export function identityKey(revision: number, windowKey: string): string {
  return `${String(revision)}\0${windowKey}`;
}

export function timedWindowKey(localYmdValue: string, weekday: number, startHm: string): string {
  return `timed:${localYmdValue}:${String(weekday)}:${startHm}`;
}

export function weeklyWindowKey(weekStartYmd: string): string {
  return `week:${weekStartYmd}`;
}

export function compareOpportunities(a: Opportunity, b: Opportunity): number {
  const byStart = a.startsAt.getTime() - b.startsAt.getTime();
  if (byStart !== 0) return byStart;
  const byKey = a.windowKey.localeCompare(b.windowKey);
  if (byKey !== 0) return byKey;
  return a.revision - b.revision;
}

export function planOpportunities(input: PlanOpportunitiesInput): Opportunity[] {
  const { revision, existing, pauseRanges, now, horizonEnd } = input;
  const current = existing.filter((row) => row.revision === revision.revision);
  const prior = existing.filter((row) => row.revision !== revision.revision);
  const existingByKey = new Map<string, Opportunity>();
  for (const row of current) {
    existingByKey.set(identityKey(row.revision, row.windowKey), row);
  }

  const out: Opportunity[] = [];
  for (const row of prior) {
    if (row.startsAt.getTime() > now.getTime() && row.status !== 'canceled') {
      out.push({ ...row, status: 'canceled', updatedAt: now });
    } else {
      out.push(row);
    }
  }

  const planned = planCurrent({ revision, existingByKey, pauseRanges, now, horizonEnd });
  const plannedKeys = new Set(planned.map((row) => identityKey(row.revision, row.windowKey)));
  out.push(...planned);

  for (const row of current) {
    if (plannedKeys.has(identityKey(row.revision, row.windowKey))) continue;
    if (row.startsAt.getTime() > now.getTime()) {
      out.push({ ...row, status: 'canceled', updatedAt: now });
    } else {
      out.push(row);
    }
  }

  out.sort(compareOpportunities);
  return out;
}

function planCurrent(input: {
  revision: RuleRevision;
  existingByKey: Map<string, Opportunity>;
  pauseRanges: PlanOpportunitiesInput['pauseRanges'];
  now: Date;
  horizonEnd: Date;
}): Opportunity[] {
  const { revision, horizonEnd } = input;
  if (revision.activatedAt.getTime() > horizonEnd.getTime()) return [];
  if (revision.cadence.kind === 'timed') {
    return planTimed(input, revision.cadence);
  }
  return planWeekly(input, revision.cadence);
}

function planTimed(
  input: {
    revision: RuleRevision;
    existingByKey: Map<string, Opportunity>;
    pauseRanges: PlanOpportunitiesInput['pauseRanges'];
    now: Date;
    horizonEnd: Date;
  },
  cadence: Extract<ContinuityCadence, { kind: 'timed' }>,
): Opportunity[] {
  const { revision, horizonEnd } = input;
  const grace = graceHoursOf(cadence);
  const startYmd = localYmd(revision.activatedAt, revision.timezone);
  const endYmd = localYmd(horizonEnd, revision.timezone);
  const slotsByWeekday = groupSlots(cadence.slots);
  const planned: Opportunity[] = [];

  for (const ymd of eachYmd(startYmd, endYmd)) {
    const weekday = weekdayOfYmd(ymd);
    const slots = slotsByWeekday.get(weekday) ?? [];
    for (const slot of slots) {
      const startsAt = zonedDateTime(ymd, slot.startHm, revision.timezone);
      if (startsAt.getTime() < revision.activatedAt.getTime()) continue;
      if (startsAt.getTime() > horizonEnd.getTime()) continue;
      const endsAt = plusMinutes(startsAt, slot.durationMin);
      const checkAt = plusHours(endsAt, grace);
      planned.push(
        adopt(input, {
          kind: 'timed',
          windowKey: timedWindowKey(ymd, slot.weekday, slot.startHm),
          startsAt,
          endsAt,
          checkAt,
          localStartDate: ymd,
          localEndDate: localYmd(endsAt, revision.timezone),
          targetCount: 1,
          observeOnly: false,
        }),
      );
    }
  }
  return planned;
}

function planWeekly(
  input: {
    revision: RuleRevision;
    existingByKey: Map<string, Opportunity>;
    pauseRanges: PlanOpportunitiesInput['pauseRanges'];
    now: Date;
    horizonEnd: Date;
  },
  cadence: Extract<ContinuityCadence, { kind: 'weekly_count' }>,
): Opportunity[] {
  const { revision, horizonEnd } = input;
  const grace = graceHoursOf(cadence);
  const activatedYmd = localYmd(revision.activatedAt, revision.timezone);
  const lastYmd = localYmd(horizonEnd, revision.timezone);
  let weekStart = startOfWeekYmd(activatedYmd, revision.weekStartsOn);
  const planned: Opportunity[] = [];

  while (weekStart <= lastYmd) {
    const startsAt = zonedDateTime(weekStart, '00:00', revision.timezone);
    if (startsAt.getTime() > horizonEnd.getTime()) break;
    const localEndDate = addDaysYmd(weekStart, 6);
    const endsAt = zonedDateTime(addDaysYmd(weekStart, 7), '00:00', revision.timezone);
    const checkAt = plusHours(endsAt, grace);
    planned.push(
      adopt(input, {
        kind: 'weekly_count',
        windowKey: weeklyWindowKey(weekStart),
        startsAt,
        endsAt,
        checkAt,
        localStartDate: weekStart,
        localEndDate,
        targetCount: cadence.count,
        observeOnly: revision.activatedAt.getTime() > startsAt.getTime(),
      }),
    );
    weekStart = addDaysYmd(weekStart, 7);
  }
  return planned;
}

function groupSlots(slots: ContinuityTimedSlot[]): Map<number, ContinuityTimedSlot[]> {
  const map = new Map<number, ContinuityTimedSlot[]>();
  for (const slot of slots) {
    const list = map.get(slot.weekday) ?? [];
    list.push(slot);
    map.set(slot.weekday, list);
  }
  return map;
}

function adopt(
  input: {
    revision: RuleRevision;
    existingByKey: Map<string, Opportunity>;
    pauseRanges: PlanOpportunitiesInput['pauseRanges'];
    now: Date;
  },
  draft: {
    kind: Opportunity['kind'];
    windowKey: string;
    startsAt: Date;
    endsAt: Date;
    checkAt: Date;
    localStartDate: string;
    localEndDate: string;
    targetCount: number;
    observeOnly: boolean;
  },
): Opportunity {
  const { revision, existingByKey, pauseRanges, now } = input;
  const prev = existingByKey.get(identityKey(revision.revision, draft.windowKey));
  const startsAt = prev?.startsAt ?? draft.startsAt;
  const endsAt = prev?.endsAt ?? draft.endsAt;
  const checkAt = prev?.checkAt ?? draft.checkAt;
  const localStartDate = prev?.localStartDate ?? draft.localStartDate;
  const localEndDate = prev?.localEndDate ?? draft.localEndDate;
  const timezoneSnapshot = prev?.timezoneSnapshot ?? revision.timezone;
  const paused = overlapsPauseRanges(startsAt, checkAt, pauseRanges);
  const status = now.getTime() < startsAt.getTime() ? 'scheduled' : 'open';
  return {
    id: prev?.id ?? randomUUID(),
    userId: nonempty(prev?.userId) ?? revision.userId ?? '',
    contractId: nonempty(prev?.contractId) ?? revision.contractId ?? '',
    revision: revision.revision,
    kind: draft.kind,
    windowKey: draft.windowKey,
    startsAt,
    endsAt,
    checkAt,
    localStartDate,
    localEndDate,
    timezoneSnapshot,
    targetCount: draft.targetCount,
    status,
    exemptReason: paused ? 'paused' : null,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    observeOnly: draft.observeOnly,
  };
}

function nonempty(value: string | undefined): string | undefined {
  return value ? value : undefined;
}
