import { randomUUID } from 'node:crypto';
import type { ContinuityCadence } from '@vital/dto';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  planOpportunities,
  recompute,
  timedWindowKey,
  weeklyWindowKey,
  type Evidence,
  type Opportunity,
  type PauseRange,
  type RecomputeInput,
  type RecomputeResult,
  type RuleRevision,
} from '../../src/continuity/rules/index.js';

const TZ = 'Asia/Shanghai';
const WEEK_STARTS_ON = 1 as const;
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONTRACT_ID = '22222222-2222-4222-8222-222222222222';
const HORIZON = sh('2026-12-01T00:00:00');

/** Tuesday / Thursday 20:00 Asia/Shanghai, 60 min, default 12h grace. */
const TUE = timedWindowKey('2026-10-27', 2, '20:00');
const THU = timedWindowKey('2026-10-29', 4, '20:00');
const WEEK_1 = weeklyWindowKey('2026-10-26');
const WEEK_2 = weeklyWindowKey('2026-11-02');
const WEEK_3 = weeklyWindowKey('2026-11-09');

function sh(localIso: string): Date {
  return DateTime.fromISO(localIso, { zone: TZ }).toJSDate();
}

function timedCadence(graceHours = 12): ContinuityCadence {
  return {
    kind: 'timed',
    slots: [
      { weekday: 2, startHm: '20:00', durationMin: 60 },
      { weekday: 4, startHm: '20:00', durationMin: 60 },
    ],
    graceHours,
  };
}

function weeklyCadence(count = 1, graceHours = 12): ContinuityCadence {
  return { kind: 'weekly_count', count, durationMin: 20, graceHours };
}

function revision(cadence: ContinuityCadence, activatedAt: Date, n = 1, timezone = TZ): RuleRevision {
  return {
    revision: n,
    cadence,
    timezone,
    weekStartsOn: WEEK_STARTS_ON,
    activatedAt,
    userId: USER_ID,
    contractId: CONTRACT_ID,
  };
}

function evidence(partial: {
  occurredAt: Date;
  recordedAt?: Date;
  sourceType?: Evidence['sourceType'];
  sourceId?: string | null;
  sourceRevision?: number | null;
  actor?: Evidence['actor'];
  body?: Record<string, unknown>;
  supersedesId?: string | null;
  retractedAt?: Date | null;
  opportunityId?: string;
  id?: string;
}): Evidence {
  const row: Evidence = {
    id: partial.id ?? randomUUID(),
    userId: USER_ID,
    sourceType: partial.sourceType ?? 'self_report',
    sourceId: partial.sourceId === undefined ? null : partial.sourceId,
    sourceRevision: partial.sourceRevision === undefined ? null : partial.sourceRevision,
    actor: partial.actor ?? 'user',
    occurredAt: partial.occurredAt,
    recordedAt: partial.recordedAt ?? partial.occurredAt,
    body: partial.body ?? {},
    supersedesId: partial.supersedesId ?? null,
    retractedAt: partial.retractedAt ?? null,
  };
  if (partial.opportunityId !== undefined) row.opportunityId = partial.opportunityId;
  return row;
}

function run(partial: Omit<RecomputeInput, 'pauseRanges' | 'horizonEnd'> & {
  pauseRanges?: PauseRange[];
  horizonEnd?: Date;
}): RecomputeResult {
  return recompute({
    revision: partial.revision,
    existing: partial.existing,
    evidence: partial.evidence,
    pauseRanges: partial.pauseRanges ?? [],
    now: partial.now,
    horizonEnd: partial.horizonEnd ?? HORIZON,
  });
}

function byKey(result: RecomputeResult, windowKey: string, rev?: number): Opportunity {
  const found = result.opportunities.find(
    (row) => row.windowKey === windowKey && (rev === undefined || row.revision === rev),
  );
  expect(found, windowKey).toBeTruthy();
  if (!found) throw new Error(`missing ${windowKey}`);
  return found;
}

function linkedTo(result: RecomputeResult, windowKey: string): string[] {
  const id = byKey(result, windowKey).id;
  return result.links.filter((link) => link.opportunityId === id).map((link) => link.evidenceId);
}

describe('continuity rules', () => {
  it('1. Friday late-record of Thursday timed slot clears consecutive stall', () => {
    const activatedAt = sh('2026-10-26T00:00:00');
    const wed = sh('2026-10-28T12:00:00');
    const friday = sh('2026-10-30T20:00:00');
    const base = { revision: revision(timedCadence(), activatedAt), existing: [] as Opportunity[] };

    const midweek = run({ ...base, evidence: [], now: wed });
    expect(byKey(midweek, TUE).status).toBe('missed');
    expect(byKey(midweek, THU).status).toBe('scheduled');
    expect(midweek.stall.kind).toBe('watching');
    expect(midweek.judgement).toBe('watching');
    expect(midweek.stall.factRefs.reasonCode).toBe('no_record');

    const bothMissed = run({ ...base, evidence: [], now: friday });
    expect(byKey(bothMissed, TUE).status).toBe('missed');
    expect(byKey(bothMissed, THU).status).toBe('missed');
    expect(bothMissed.stall.kind).toBe('stall');
    expect(bothMissed.judgement).toBe('needs_adjust');

    const late = evidence({
      occurredAt: sh('2026-10-29T20:30:00'),
      recordedAt: sh('2026-10-30T18:00:00'),
      sourceType: 'self_report',
    });
    const recovered = run({ ...base, evidence: [late], now: friday });
    expect(byKey(recovered, TUE).status).toBe('missed');
    expect(byKey(recovered, THU).status).toBe('met');
    expect(recovered.stall.kind).toBe('none');
    expect(recovered.judgement).toBe('on_track');
    expect(linkedTo(recovered, THU)).toEqual([late.id]);
    expect(JSON.stringify(recovered)).not.toMatch(/连续失败|欠了两次|user_lazy/);
  });

  it('2. weekly_count checks only after week end + grace, not mid-week', () => {
    const activatedAt = sh('2026-10-26T00:00:00');
    const rev = revision(weeklyCadence(1), activatedAt);
    const mid = run({ revision: rev, existing: [], evidence: [], now: sh('2026-10-28T16:00:00') });
    const week = byKey(mid, WEEK_1);
    expect(week.status).toBe('open');
    expect(week.observeOnly).toBe(false);
    expect(mid.stall.kind).toBe('none');
    expect(mid.judgement).toBe('on_track');
    expect(week.checkAt.getTime()).toBe(sh('2026-11-02T12:00:00').getTime());

    const beforeGrace = run({
      revision: rev,
      existing: mid.opportunities,
      evidence: [],
      now: sh('2026-11-02T11:00:00'),
    });
    expect(byKey(beforeGrace, WEEK_1).status).toBe('open');
    expect(beforeGrace.stall.kind).toBe('none');

    const afterGrace = run({
      revision: rev,
      existing: mid.opportunities,
      evidence: [],
      now: sh('2026-11-02T12:00:00'),
    });
    expect(byKey(afterGrace, WEEK_1).status).toBe('missed');
    expect(afterGrace.stall.kind).toBe('stall');
    expect(afterGrace.judgement).toBe('needs_adjust');
    expect(afterGrace.stall.factRefs.reasonCode).toBe('no_record');
  });

  it('3. two-week pause exempts overlapping windows and does not backfill debt', () => {
    const activatedAt = sh('2026-10-26T00:00:00');
    const pauseRanges: PauseRange[] = [{ start: sh('2026-10-26T00:00:00'), end: sh('2026-11-09T00:00:00') }];
    const resumed = run({
      revision: revision(weeklyCadence(1), activatedAt),
      existing: [],
      evidence: [],
      pauseRanges,
      now: sh('2026-11-10T09:00:00'),
    });
    expect(byKey(resumed, WEEK_1).status).toBe('exempt');
    expect(byKey(resumed, WEEK_1).exemptReason).toBe('paused');
    expect(byKey(resumed, WEEK_2).status).toBe('exempt');
    expect(byKey(resumed, WEEK_2).exemptReason).toBe('paused');
    expect(byKey(resumed, WEEK_3).status).toBe('open');
    expect(byKey(resumed, WEEK_3).exemptReason).toBeNull();
    expect(resumed.stall.kind).toBe('none');
    expect(resumed.judgement).toBe('on_track');

    const stillPaused = run({
      revision: revision(weeklyCadence(1), activatedAt),
      existing: [],
      evidence: [],
      pauseRanges: [{ start: sh('2026-10-26T00:00:00'), end: null }],
      now: sh('2026-11-10T09:00:00'),
    });
    expect(byKey(stillPaused, WEEK_3).status).toBe('exempt');
    expect(stillPaused.judgement).toBe('waiting');
    expect(stillPaused.stall.kind).toBe('none');
  });

  it('4. first activation partial week is observe-only and never missed', () => {
    const activatedAt = sh('2026-10-28T10:00:00');
    const afterFirstCheck = run({
      revision: revision(weeklyCadence(2), activatedAt),
      existing: [],
      evidence: [],
      now: sh('2026-11-03T09:00:00'),
    });
    const first = byKey(afterFirstCheck, WEEK_1);
    expect(first.observeOnly).toBe(true);
    expect(first.status).toBe('exempt');
    expect(first.exemptReason).toBe('observe_only');
    const second = byKey(afterFirstCheck, WEEK_2);
    expect(second.observeOnly).toBe(false);
    expect(second.status).toBe('open');
    expect(afterFirstCheck.stall.kind).toBe('none');
    expect(afterFirstCheck.judgement).toBe('on_track');
  });

  it('5. agent_prep and agent-authored task_done do not count as progress', () => {
    const friday = sh('2026-10-30T20:00:00');
    const result = run({
      revision: revision(timedCadence(), sh('2026-10-26T00:00:00')),
      existing: [],
      now: friday,
      evidence: [
        evidence({
          sourceType: 'agent_prep',
          actor: 'agent',
          occurredAt: sh('2026-10-29T20:30:00'),
        }),
        evidence({
          sourceType: 'task_done',
          actor: 'agent',
          sourceId: randomUUID(),
          sourceRevision: 1,
          occurredAt: sh('2026-10-27T20:30:00'),
        }),
      ],
    });
    expect(result.links).toEqual([]);
    expect(byKey(result, TUE).status).toBe('missed');
    expect(byKey(result, THU).status).toBe('missed');
    expect(result.stall.kind).toBe('stall');
  });

  it('6. user self-report already-done counts; retract undoes it', () => {
    const friday = sh('2026-10-30T20:00:00');
    const done = evidence({
      sourceType: 'user_confirm',
      occurredAt: sh('2026-10-29T20:20:00'),
      recordedAt: friday,
    });
    const counted = run({
      revision: revision(timedCadence(), sh('2026-10-26T00:00:00')),
      existing: [],
      evidence: [done],
      now: friday,
    });
    expect(byKey(counted, THU).status).toBe('met');
    expect(linkedTo(counted, THU)).toEqual([done.id]);

    const retracted = run({
      revision: revision(timedCadence(), sh('2026-10-26T00:00:00')),
      existing: counted.opportunities,
      evidence: [{ ...done, retractedAt: friday }],
      now: friday,
    });
    expect(byKey(retracted, THU).status).toBe('missed');
    expect(retracted.links).toEqual([]);
  });

  it('7. same source cannot debit two timed opportunities or double-count a week', () => {
    const friday = sh('2026-10-30T20:00:00');
    const sourceId = randomUUID();
    const timed = run({
      revision: revision(timedCadence(), sh('2026-10-26T00:00:00')),
      existing: [],
      now: friday,
      evidence: [
        evidence({
          sourceType: 'task_done',
          sourceId,
          sourceRevision: 3,
          occurredAt: sh('2026-10-27T20:30:00'),
        }),
        evidence({
          sourceType: 'task_done',
          sourceId,
          sourceRevision: 3,
          occurredAt: sh('2026-10-29T20:30:00'),
        }),
      ],
    });
    expect(byKey(timed, TUE).status).toBe('met');
    expect(byKey(timed, THU).status).toBe('missed');
    expect(timed.links).toHaveLength(1);

    const weekEnd = sh('2026-11-02T13:00:00');
    const weekly = run({
      revision: revision(weeklyCadence(2), sh('2026-10-26T00:00:00')),
      existing: [],
      now: weekEnd,
      evidence: [
        evidence({
          sourceType: 'habit_checkin',
          sourceId,
          sourceRevision: 1,
          occurredAt: sh('2026-10-27T08:00:00'),
        }),
        evidence({
          sourceType: 'habit_checkin',
          sourceId,
          sourceRevision: 1,
          occurredAt: sh('2026-10-29T08:00:00'),
        }),
      ],
    });
    expect(byKey(weekly, WEEK_1).status).toBe('missed');
    expect(weekly.links).toHaveLength(2);
    expect(weekly.stall.kind).toBe('stall');
  });

  it('8. timed occurredAt between two windows is not auto-attributed', () => {
    const friday = sh('2026-10-30T20:00:00');
    const gap = evidence({
      occurredAt: sh('2026-10-28T12:00:00'),
      recordedAt: friday,
      sourceType: 'self_report',
    });
    const result = run({
      revision: revision(timedCadence(), sh('2026-10-26T00:00:00')),
      existing: [],
      evidence: [gap],
      now: friday,
    });
    expect(result.links).toEqual([]);
    expect(byKey(result, TUE).status).toBe('missed');
    expect(byKey(result, THU).status).toBe('missed');

    const overlapCadence: ContinuityCadence = {
      kind: 'timed',
      slots: [
        { weekday: 2, startHm: '20:00', durationMin: 60 },
        { weekday: 4, startHm: '20:00', durationMin: 60 },
      ],
      graceHours: 48,
    };
    const ambiguous = run({
      revision: revision(overlapCadence, sh('2026-10-26T00:00:00')),
      existing: [],
      evidence: [evidence({ occurredAt: sh('2026-10-29T20:30:00') })],
      now: friday,
    });
    expect(ambiguous.links).toEqual([]);
    expect(byKey(ambiguous, TUE).status).toBe('missed');
    expect(byKey(ambiguous, THU).status).toBe('open');
  });

  it('9. timezone change keeps historical window snapshot and local-date attribution', () => {
    const shanghaiRev = revision(weeklyCadence(1), sh('2026-10-26T00:00:00'), 1, TZ);
    const sundayNight = evidence({ occurredAt: sh('2026-11-01T23:00:00') });
    const mondayMorning = evidence({ occurredAt: sh('2026-11-02T00:30:00') });
    const first = run({
      revision: shanghaiRev,
      existing: [],
      evidence: [sundayNight, mondayMorning],
      now: sh('2026-11-01T23:30:00'),
    });
    const historical = byKey(first, WEEK_1, 1);
    expect(historical.timezoneSnapshot).toBe(TZ);
    expect(historical.localStartDate).toBe('2026-10-26');
    expect(historical.localEndDate).toBe('2026-11-01');
    expect(historical.status).toBe('met');
    expect(linkedTo(first, WEEK_1)).toEqual([sundayNight.id]);

    const changedAt = sh('2026-11-04T09:00:00');
    const second = run({
      revision: revision(weeklyCadence(1), changedAt, 2, 'America/Los_Angeles'),
      existing: first.opportunities,
      evidence: [sundayNight, mondayMorning],
      now: changedAt,
    });
    const kept = byKey(second, WEEK_1, 1);
    expect(kept.id).toBe(historical.id);
    expect(kept.timezoneSnapshot).toBe(TZ);
    expect(kept.localStartDate).toBe('2026-10-26');
    expect(kept.localEndDate).toBe('2026-11-01');
    expect(kept.status).toBe('met');
    expect(second.links.filter((link) => link.opportunityId === kept.id).map((link) => link.evidenceId)).toEqual([
      sundayNight.id,
    ]);
    const laWindows = second.opportunities.filter((row) => row.revision === 2);
    expect(laWindows.length).toBeGreaterThan(0);
    expect(laWindows.every((row) => row.timezoneSnapshot === 'America/Los_Angeles')).toBe(true);
    expect(second.opportunities.some((row) => row.revision === 1 && row.status === 'canceled')).toBe(
      true,
    );
  });

  it('10. cadence change cancels old-revision future windows and keeps started ones', () => {
    const activatedAt = sh('2026-10-26T00:00:00');
    const wednesday = sh('2026-10-28T12:00:00');
    const timed = run({
      revision: revision(timedCadence(), activatedAt, 1),
      existing: [],
      evidence: [],
      now: wednesday,
    });
    expect(byKey(timed, TUE, 1).status).toBe('missed');
    expect(byKey(timed, THU, 1).status).toBe('scheduled');

    const nextTue = timedWindowKey('2026-11-03', 2, '20:00');
    expect(byKey(timed, nextTue, 1).status).toBe('scheduled');

    const switched = run({
      revision: revision(weeklyCadence(1), wednesday, 2),
      existing: timed.opportunities,
      evidence: [],
      now: wednesday,
    });
    expect(byKey(switched, TUE, 1).status).toBe('missed');
    expect(byKey(switched, THU, 1).status).toBe('canceled');
    expect(byKey(switched, nextTue, 1).status).toBe('canceled');
    const week = byKey(switched, WEEK_1, 2);
    expect(week.status).toBe('open');
    expect(week.observeOnly).toBe(true);
    expect(switched.stall.kind).toBe('none');
  });

  it('does not plan timed slots before activatedAt and defaults grace to 12h', () => {
    const activatedAt = sh('2026-10-29T10:00:00');
    const planned = planOpportunities({
      revision: revision(timedCadence(), activatedAt),
      existing: [],
      pauseRanges: [],
      now: sh('2026-10-29T11:00:00'),
      horizonEnd: sh('2026-10-30T00:00:00'),
    });
    expect(planned.some((row) => row.windowKey === TUE)).toBe(false);
    const thu = planned.find((row) => row.windowKey === THU);
    expect(thu).toBeTruthy();
    expect(thu?.startsAt.getTime()).toBe(sh('2026-10-29T20:00:00').getTime());
    expect(thu?.endsAt.getTime()).toBe(sh('2026-10-29T21:00:00').getTime());
    expect(thu?.checkAt.getTime()).toBe(sh('2026-10-30T09:00:00').getTime());
  });

  it('superseding evidence replaces the prior row before counting', () => {
    const friday = sh('2026-10-30T20:00:00');
    const original = evidence({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      occurredAt: sh('2026-10-27T20:10:00'),
      sourceType: 'self_report',
    });
    const replacement = evidence({
      occurredAt: sh('2026-10-29T20:10:00'),
      sourceType: 'self_report',
      supersedesId: original.id,
    });
    const result = run({
      revision: revision(timedCadence(), sh('2026-10-26T00:00:00')),
      existing: [],
      evidence: [original, replacement],
      now: friday,
    });
    expect(byKey(result, TUE).status).toBe('missed');
    expect(byKey(result, THU).status).toBe('met');
    expect(linkedTo(result, THU)).toEqual([replacement.id]);
  });

  it('explicit opportunityId binding wins over unique-window auto debit', () => {
    const friday = sh('2026-10-30T20:00:00');
    const seeded = run({
      revision: revision(timedCadence(), sh('2026-10-26T00:00:00')),
      existing: [],
      evidence: [],
      now: sh('2026-10-27T21:00:00'),
    });
    const thursdayId = byKey(seeded, THU).id;
    const bound = evidence({
      occurredAt: sh('2026-10-27T20:30:00'),
      opportunityId: thursdayId,
      sourceType: 'self_report',
    });
    const result = run({
      revision: revision(timedCadence(), sh('2026-10-26T00:00:00')),
      existing: seeded.opportunities,
      evidence: [bound],
      now: friday,
    });
    expect(linkedTo(result, THU)).toEqual([bound.id]);
    expect(linkedTo(result, TUE)).toEqual([]);
    expect(byKey(result, THU).status).toBe('met');
    expect(byKey(result, TUE).status).toBe('missed');
  });
});
