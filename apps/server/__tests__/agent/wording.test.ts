import { describe, expect, it } from 'vitest';
import { isStaleWording, planWordingUpdate, shouldRefreshWording, wordingKey } from '../../src/agent/wording.js';

const at = (iso: string) => new Date(iso);

describe('shouldRefreshWording', () => {
  it('runs once when the thread has never been written or judged', () => {
    expect(
      shouldRefreshWording({ agentUpdatedAt: null, lastFeedbackAt: null, latestFactAt: null }),
    ).toBe(true);
  });

  it('stays quiet after a dismissal until a real task changes', () => {
    expect(
      shouldRefreshWording({
        agentUpdatedAt: at('2026-10-18T16:00:00Z'),
        lastFeedbackAt: at('2026-10-20T15:05:00Z'),
        latestFactAt: at('2026-10-17T02:00:00Z'),
      }),
    ).toBe(false);
    expect(
      shouldRefreshWording({
        agentUpdatedAt: at('2026-10-18T16:00:00Z'),
        lastFeedbackAt: at('2026-10-20T15:05:00Z'),
        latestFactAt: at('2026-10-20T16:00:00Z'),
      }),
    ).toBe(true);
  });

  it('does not treat a habit-only thread as new work', () => {
    expect(
      shouldRefreshWording({
        agentUpdatedAt: at('2026-10-16T16:01:00Z'),
        lastFeedbackAt: at('2026-10-16T16:01:00Z'),
        latestFactAt: null,
      }),
    ).toBe(false);
  });
});

describe('planWordingUpdate', () => {
  it('drops the meeting status and room-booking advice from the activity log', () => {
    const plan = planWordingUpdate({
      threadName: '技术周会与国例会',
      currentHeadline: null,
      currentSuggestion: null,
      ruleNextStep: null,
      nextHeadline: '终端技术周会与欧洲机房建设国例会临近截止，均未启动',
      nextSuggestion: '先为终端技术周会和国例会订好会议室，同步议程给席铭，并预留准备时间。',
      milestoneTotal: 0,
    });
    expect(plan.proposeHeadline).toBe(false);
    expect(plan.proposeSuggestion).toBe(false);
  });

  it('drops a repeated 仍未启动 and a 待定义 status', () => {
    expect(
      planWordingUpdate({
        threadName: '生活计划',
        currentHeadline: '香港旅游仍未启动，行程未定',
        currentSuggestion: null,
        ruleNextStep: '香港旅游',
        nextHeadline: '香港旅游仍未启动，行程未定',
        nextSuggestion: '先确定出行日期和天数，再列初步行程框架。',
        milestoneTotal: 0,
      }),
    ).toMatchObject({ proposeHeadline: false, headline: '', proposeSuggestion: false });

    expect(
      isStaleWording('Inwit 产品优化线程任务与习惯均为空，处于待定义状态'),
    ).toBe(true);
  });

  it('clears a stored daily count without asking again', () => {
    const plan = planWordingUpdate({
      threadName: '身体健康',
      currentHeadline: '喝水习惯近7天打卡7天，锻炼打卡2天；今日喝水 0/8、锻炼未打卡。',
      currentSuggestion: '今天先完成一次喝水打卡，锻炼安排在晚饭后。',
      ruleNextStep: '喝水',
      nextHeadline: '喝水连续打卡，今日喝水 3/8',
      nextSuggestion: '今天先完成一次喝水打卡',
      milestoneTotal: 0,
    });
    expect(plan).toMatchObject({
      proposeHeadline: false,
      headline: '',
      proposeSuggestion: false,
    });
  });

  it('keeps a milestone fraction and proposes a real change', () => {
    expect(isStaleWording('循环机制还没写完 1/3 里程碑', 3)).toBe(false);
    const plan = planWordingUpdate({
      threadName: '开发问题修复',
      currentHeadline: 'mock 问题还在',
      currentSuggestion: null,
      ruleNextStep: 'Agent 工作流 mock 问题',
      nextHeadline: 'skill prefix 已定位到初始化模板',
      nextSuggestion: '改初始化模板里的 skill prefix，再跑一次新项目',
      milestoneTotal: 0,
    });
    expect(plan.proposeHeadline).toBe(true);
    expect(plan.headline).toBe('skill prefix 已定位到初始化模板');
    expect(plan.proposeSuggestion).toBe(true);
  });

  it('treats a renamed copy of the same sentence as no change', () => {
    expect(
      wordingKey('开发问题修复：Agent 工作流 mock 问题仍未处理', '开发问题修复'),
    ).toBe(wordingKey('Agent 工作流 mock 问题仍未处理', '开发问题修复'));
    const plan = planWordingUpdate({
      threadName: '开发问题修复',
      currentHeadline: 'Agent 工作流 mock 问题仍未处理',
      currentSuggestion: null,
      ruleNextStep: 'Agent 工作流 mock 问题',
      nextHeadline: '开发问题修复：开发问题修复：Agent 工作流 mock 问题仍未处理',
      nextSuggestion: 'Agent 工作流 mock 问题',
      milestoneTotal: 0,
    });
    expect(plan.proposeHeadline).toBe(false);
    expect(plan.proposeSuggestion).toBe(false);
    expect(plan.headline).toBeNull();
  });
});
