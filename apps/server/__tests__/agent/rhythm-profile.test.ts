import { buildTodayPlan, parseRhythmMemory } from '@vital/dto';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { acceptMorningBriefText, morningBriefTemplate } from '../../src/notifications/morning-brief.js';
import {
  acceptRhythmEntries,
  aggregateRhythm,
  buildRhythmPrompt,
  describeRhythmFacts,
  orderModulesForRhythm,
  preferredWindows,
  profileFromMemories,
  suppressedFacets,
  type RhythmCompletion,
  type RhythmProfile,
} from '../../src/agent/rhythm-profile.js';

const ZONE = 'Asia/Shanghai';

function at(day: number, hour: number, minute = 30): Date {
  return DateTime.fromObject({ year: 2026, month: 9, day, hour, minute }, { zone: ZONE }).toJSDate();
}

function completions(days: number, hour: number, estimate: number | null = 40): RhythmCompletion[] {
  return Array.from({ length: days }, (_, index) => ({
    at: at(1 + index, hour),
    estimateMinutes: estimate,
  }));
}

describe('rhythm profile distill input', () => {
  it('does not build a profile when the sample spans fewer than 14 days', () => {
    const facts = aggregateRhythm({
      zone: ZONE,
      completions: completions(14, 9),
      habitChecks: [],
      defers: [],
    });
    expect(facts.spanDays).toBe(13);
    expect(facts.enough).toBe(false);
    expect(facts.peak).not.toBeNull();
    expect(buildRhythmPrompt(facts, [])).toBeNull();
    expect(describeRhythmFacts(facts, [])).toContain('跨度 13 天');
  });

  it('describes a two-week morning cluster without inventing a weak weekday', () => {
    const facts = aggregateRhythm({
      zone: ZONE,
      completions: completions(15, 9),
      habitChecks: [{ at: at(3, 9, 5) }, { at: at(16, 9, 10) }],
      defers: [{ title: '写方案', outcomeName: '产品方案', deferCount: 4 }],
    });
    expect(facts.enough).toBe(true);
    expect(facts.spanDays).toBe(15);
    expect(facts.peak).toEqual({ startHour: 9, endHour: 11, count: 17 });
    expect(facts.lowWeekday).toBeNull();
    expect(facts.avgEstimateMinutes).toBe(40);
    expect(facts.deferTheme).toEqual({ topic: '产品方案', count: 4 });
    const prompt = buildRhythmPrompt(facts, []);
    expect(prompt).not.toBeNull();
    expect(prompt?.system).toContain('profile.rhythm');
    expect(prompt?.user).toContain('09:00 17');
    expect(prompt?.user).toContain('样本量 21');
    expect(prompt?.user).toContain('产品方案');
    expect(prompt?.user).toContain('peak_hours');
    expect(prompt?.user).not.toContain('low_weekday（低效星期）');
  });

  it('does not call a flat day a peak', () => {
    const rows: RhythmCompletion[] = [];
    for (let day = 1; day <= 15; day += 1) {
      for (const hour of [0, 6, 12, 18]) rows.push({ at: at(day, hour), estimateMinutes: null });
    }
    const facts = aggregateRhythm({ zone: ZONE, completions: rows, habitChecks: [], defers: [] });
    expect(facts.enough).toBe(true);
    expect(facts.peak).toBeNull();
    expect(facts.avgEstimateMinutes).toBeNull();
    expect(buildRhythmPrompt(facts, [])).toBeNull();
  });

  it('keeps a deleted facet out of the prompt and out of accepted entries', () => {
    const facts = aggregateRhythm({
      zone: ZONE,
      completions: completions(15, 9),
      habitChecks: [],
      defers: [{ title: '写方案', outcomeName: null, deferCount: 3 }],
    });
    const suppressed = suppressedFacets([
      { operation: 'manual.drop', before: { content: '[rhythm:peak_hours start=540 end=660] 09:00–11:00 完成更集中' } },
      { operation: 'drop', before: { content: '[rhythm:defer_theme] 「写方案」常被推迟' } },
    ]);
    expect(suppressed).toEqual(['peak_hours']);
    const prompt = buildRhythmPrompt(facts, suppressed);
    expect(prompt?.user).toContain('不要再生成');
    expect(prompt?.user).toContain('高效时段（peak_hours）');
    const writable = prompt?.user.split('可写种类：')[1]?.split('已删除')[0] ?? '';
    expect(writable).not.toContain('peak_hours');
    expect(writable).toContain('defer_theme');
    const accepted = acceptRhythmEntries(facts, suppressed, [
      { facet: 'peak_hours', text: '09:00–11:00 完成更集中' },
      { facet: 'defer_theme', text: '「写方案」反复被推迟' },
      { facet: 'task_grain', text: '平均大约 40 分钟' },
    ]);
    expect(accepted.map((entry) => entry.facet)).toEqual(['defer_theme', 'task_grain']);
    expect(parseRhythmMemory(accepted[0]?.content ?? '')?.facet).toBe('defer_theme');
    expect(parseRhythmMemory(accepted[1]?.content ?? '')?.minutes).toBe(40);
  });
});

describe('rhythm profile consumers', () => {
  const profile: RhythmProfile = {
    generatedAt: '2026-10-15T01:00:00.000Z',
    sampleCount: 21,
    peak: { startMin: 9 * 60, endMin: 11 * 60, text: '09:00–11:00 完成更集中' },
    lowWeekday: { weekday: 4, text: '周四完成明显更少' },
    taskGrain: { minutes: 40, text: '平均大约 40 分钟' },
    deferTheme: { text: '「写方案」反复被推迟' },
  };

  it('leaves module order untouched without a profile', () => {
    const modules = [{ id: 'weather' }, { id: 'focus' }, { id: 'lead' }];
    expect(orderModulesForRhythm(modules, { weekday: 4, minutes: 10 * 60 }, null)).toBe(modules);
  });

  it('pulls focus forward during the peak window and sinks it on a weak weekday', () => {
    const modules = [{ id: 'weather' }, { id: 'meetings' }, { id: 'focus' }, { id: 'lead' }];
    expect(orderModulesForRhythm(modules, { weekday: 4, minutes: 10 * 60 }, profile).map((item) => item.id)).toEqual([
      'lead',
      'focus',
      'weather',
      'meetings',
    ]);
    expect(orderModulesForRhythm(modules, { weekday: 4, minutes: 15 * 60 }, profile).map((item) => item.id)).toEqual([
      'weather',
      'meetings',
      'lead',
      'focus',
    ]);
    expect(orderModulesForRhythm(modules, { weekday: 1, minutes: 15 * 60 }, profile)).toBe(modules);
  });

  it('offers the peak window to the scheduler only when a profile has one', () => {
    expect(preferredWindows(profile)).toEqual([{ startMin: 9 * 60, endMin: 11 * 60 }]);
    expect(preferredWindows({ ...profile, peak: null })).toEqual([]);
    expect(preferredWindows(null)).toEqual([]);
    const parsed = profileFromMemories([
      {
        content: '[rhythm:peak_hours start=540 end=660] 09:00–11:00 完成更集中',
        sourceCount: 21,
        updatedAt: new Date('2026-10-15T01:00:00.000Z'),
        scope: ['profile'],
      },
    ]);
    expect(parsed?.peak?.startMin).toBe(540);
    expect(parsed?.sampleCount).toBe(21);
  });

  it('cites the profile on a morning brief only when suggesting a slot', () => {
    const briefAt = new Date('2026-10-15T23:30:00.000Z');
    const short = morningBriefTemplate(
      { plan: buildTodayPlan([], ZONE, briefAt), meetings: [], weather: null },
      '按你的节奏，09:00–11:00 完成更集中',
    );
    expect(short).toBe('今天 0 件，没有逾期');
    const facts = {
      plan: buildTodayPlan(
        [{ id: 't1', title: '写报告', status: 'todo' as const, dueAt: '2026-10-14T16:00:00.000Z', startAt: null, habitId: null, deletedAt: null, priority: 3 as const, isAllDay: false }],
        ZONE,
        briefAt,
      ),
      meetings: [
        { title: '站会', start: '09:00', allDay: false },
        { title: '评审', start: '11:00', allDay: false },
      ],
      weather: null,
    };
    const plain = morningBriefTemplate(facts);
    const cited = morningBriefTemplate(facts, '按你的节奏，09:00–11:00 完成更集中');
    expect(plain).not.toContain('节奏');
    expect(cited).toContain('空档');
    expect(cited).toContain('按你的节奏，09:00–11:00 完成更集中');
    expect(acceptMorningBriefText('站会和评审之间有空档，建议把写报告挪到明天', 1, cited, '按你的节奏，09:00–11:00 完成更集中')).toContain(
      '按你的节奏，09:00–11:00 完成更集中',
    );
  });
});
