import type { TodayPlan } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import { eveningDigestMessage } from '../../src/notifications/evening-digest.js';
import {
  energyCompletionLink,
  energyLinkSentence,
  preferEnergyPattern,
  type EnergyDayLink,
} from '../../src/notifications/energy-link.js';
import { acceptMorningBriefText, morningBriefTemplate } from '../../src/notifications/morning-brief.js';

function day(over: Partial<EnergyDayLink> & Pick<EnergyDayLink, 'day' | 'energy'>): EnergyDayLink {
  return { nextCompleted: 0, nextDueOpen: 0, ...over };
}

const emptyPlan: TodayPlan = {
  items: [],
  rest: 0,
  titles: [],
  counts: { overdue: 0, urgent: 0, high: 0, medium: 0, plain: 0 },
};

describe('energy completion link', () => {
  it('states the drop when both groups have enough days', () => {
    const link = energyCompletionLink([
      day({ day: '2026-10-05', energy: 1, nextCompleted: 1, nextDueOpen: 1 }),
      day({ day: '2026-10-06', energy: 2, nextCompleted: 0, nextDueOpen: 2 }),
      day({ day: '2026-10-07', energy: 4, nextCompleted: 2, nextDueOpen: 0 }),
      day({ day: '2026-10-08', energy: 5, nextCompleted: 3, nextDueOpen: 1 }),
    ]);
    expect(link).toEqual({
      lowDays: 2,
      otherDays: 2,
      lowPercent: 25,
      otherPercent: 88,
      dropPoints: 63,
    });
    expect(energyLinkSentence(link!)).toContain('精力 ≤ 2');
    expect(energyLinkSentence(link!)).toContain('25%');
    expect(energyLinkSentence(link!)).toContain('63');
  });

  it('does not conclude when a group has fewer than two days', () => {
    expect(
      energyCompletionLink([
        day({ day: '2026-10-05', energy: 1, nextCompleted: 0, nextDueOpen: 2 }),
        day({ day: '2026-10-06', energy: 4, nextCompleted: 2, nextDueOpen: 0 }),
        day({ day: '2026-10-07', energy: 5, nextCompleted: 2, nextDueOpen: 0 }),
      ]),
    ).toBeNull();
  });

  it('does not conclude when the next-day rate does not drop', () => {
    expect(
      energyCompletionLink([
        day({ day: '2026-10-05', energy: 1, nextCompleted: 1, nextDueOpen: 0 }),
        day({ day: '2026-10-06', energy: 2, nextCompleted: 1, nextDueOpen: 0 }),
        day({ day: '2026-10-07', energy: 4, nextCompleted: 1, nextDueOpen: 1 }),
        day({ day: '2026-10-08', energy: 5, nextCompleted: 1, nextDueOpen: 1 }),
      ]),
    ).toBeNull();
  });

  it('drops a day with no next-day denominator before counting the sample', () => {
    expect(
      energyCompletionLink([
        day({ day: '2026-10-05', energy: 1, nextCompleted: 0, nextDueOpen: 0 }),
        day({ day: '2026-10-06', energy: 2, nextCompleted: 0, nextDueOpen: 2 }),
        day({ day: '2026-10-07', energy: 4, nextCompleted: 2, nextDueOpen: 0 }),
        day({ day: '2026-10-08', energy: 5, nextCompleted: 2, nextDueOpen: 0 }),
      ]),
    ).toBeNull();
  });

  it('keeps an energy sentence inside the two-pattern cap only when the model can run', () => {
    const base = [
      { kind: 'late_night', text: '深夜' },
      { kind: 'defer', text: '推迟' },
    ];
    const energy = { kind: 'energy', text: '精力 ≤ 2' };
    expect(preferEnergyPattern(base, energy).map((item) => item.kind)).toEqual(['late_night', 'energy']);
    expect(preferEnergyPattern(base, null).map((item) => item.kind)).toEqual(['late_night', 'defer']);
  });
});

describe('low energy tone', () => {
  it('names a real task in the morning template and keeps the line if the model drops it', () => {
    const facts = {
      plan: {
        ...emptyPlan,
        items: [{ id: 't1', title: 'P10验收 可挪走', mark: 'high' as const, when: null }],
        counts: { overdue: 0, urgent: 0, high: 1, medium: 0, plain: 0 },
      },
      meetings: [],
      weather: null,
      lowEnergy: true,
    };
    const template = morningBriefTemplate(facts);
    expect(template).toContain('精力偏低（≤2）');
    expect(template).toContain('「P10验收 可挪走」可以挪到明天');
    expect(morningBriefTemplate({ ...facts, lowEnergy: false })).toBe('今天 1 件，没有逾期');
    expect(acceptMorningBriefText('今天 1 件，没有逾期', 0, template)).toBe(template);
  });

  it('softens the evening rule without nagging', () => {
    const text = eveningDigestMessage({
      completed: 1,
      openToday: 1,
      outcomes: [],
      defer: null,
      tomorrow: 'P10验收 可挪走',
      lowEnergy: true,
    });
    expect(text).toContain('今天完成了 1 件');
    expect(text).toContain('精力偏低（≤2）');
    expect(text).toContain('「P10验收 可挪走」可以挪一挪');
    expect(text).not.toMatch(/没处理|还有\s*\d+\s*件/);
    expect(
      eveningDigestMessage({
        completed: 0,
        openToday: 0,
        outcomes: [],
        defer: null,
        tomorrow: null,
        lowEnergy: true,
      }),
    ).toBe('');
  });
});
