import { describe, expect, it } from 'vitest';
import { buildHeadlinePrompt } from '../../src/agent/prompts.js';
import { milestoneProgress, withMilestoneHeadline } from '../../src/outcomes/milestones.js';

describe('milestoneProgress', () => {
  it('counts done milestones and ignores canceled and ordinary tasks', () => {
    expect(
      milestoneProgress([
        { isMilestone: true, status: 'done' },
        { isMilestone: true, status: 'todo' },
        { isMilestone: true, status: 'doing' },
        { isMilestone: true, status: 'canceled' },
        { isMilestone: false, status: 'done' },
      ]),
    ).toEqual({ done: 1, total: 3 });
  });

  it('is zero when nothing is marked', () => {
    expect(milestoneProgress([{ isMilestone: false, status: 'done' }])).toEqual({ done: 0, total: 0 });
  });
});

describe('withMilestoneHeadline', () => {
  it('appends the real fraction and replaces a made-up one', () => {
    expect(withMilestoneHeadline('这周在推进', 1, 3)).toBe('这周在推进 1/3 里程碑');
    expect(withMilestoneHeadline('已经 2/5 里程碑', 1, 3)).toBe('已经 1/3 里程碑');
    expect(withMilestoneHeadline('这周在推进 1/3 里程碑', 1, 3)).toBe('这周在推进 1/3 里程碑');
  });

  it('drops a fraction when the outcome has no milestones', () => {
    expect(withMilestoneHeadline('没有进度 1/3 里程碑', 0, 0)).toBe('没有进度');
    expect(withMilestoneHeadline('1/3 里程碑', 0, 0)).toBe('');
  });
});

describe('headline prompt milestone facts', () => {
  it('states the count when milestones exist and forbids the word otherwise', () => {
    const withMilestones = buildHeadlinePrompt({
      outcomeName: '写作',
      ruleSignal: 'flat',
      ruleNextStep: '改二稿',
      completedLast7d: 1,
      openTasks: [],
      memory: [],
      milestoneDone: 1,
      milestoneTotal: 3,
    });
    expect(withMilestones.user).toContain('里程碑：1/3。');
    expect(withMilestones.system).toContain('完成数/总数 里程碑');

    const none = buildHeadlinePrompt({
      outcomeName: '写作',
      ruleSignal: 'flat',
      ruleNextStep: null,
      completedLast7d: 0,
      openTasks: [],
      memory: [],
    });
    expect(none.user).toContain('里程碑：无。');
    expect(none.system).toContain('没有里程碑时不要写里程碑');
  });
});
