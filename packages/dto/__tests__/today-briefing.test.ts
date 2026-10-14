import { describe, expect, it } from 'vitest';
import { buildTodayPlan, noteRepeatsTasks, type BriefingTask } from '../src/today-briefing.js';
import { describeTodayLayoutFacts } from '../src/today-layout.js';

const zone = 'Asia/Shanghai';
const now = new Date('2026-10-14T04:00:00.000Z');

function task(over: Partial<BriefingTask> & Pick<BriefingTask, 'id' | 'title'>): BriefingTask {
  return {
    status: 'todo',
    dueAt: null,
    startAt: null,
    ...over,
  };
}

describe('today plan', () => {
  it('orders overdue, then urgent, high, and medium, and leaves the rest counted', () => {
    const plan = buildTodayPlan(
      [
        task({ id: 'plain', title: '买菜' }),
        task({ id: 'medium', title: '整理笔记', priority: 2 }),
        task({ id: 'high', title: '写周报', priority: 1, dueAt: '2026-10-14T10:00:00.000Z' }),
        task({ id: 'urgent', title: '回客户', priority: 0 }),
        task({ id: 'late', title: '交报告', dueAt: '2026-10-13T02:00:00.000Z', priority: 2 }),
        task({ id: 'done', title: '已完成', status: 'done', priority: 0 }),
        task({ id: 'habit', title: '喝水', habitId: 'h1', priority: 0 }),
      ],
      zone,
      now,
    );
    expect(plan.items.map((item) => item.title)).toEqual(['交报告', '回客户', '写周报', '整理笔记']);
    expect(plan.items.map((item) => item.mark)).toEqual(['overdue', 'urgent', 'high', 'medium']);
    expect(plan.items.find((item) => item.id === 'high')?.when).toBe('18:00');
    expect(plan.items.find((item) => item.id === 'late')?.when).toBe('10:00');
    expect(plan.rest).toBe(1);
    expect(plan.counts).toEqual({ overdue: 1, urgent: 1, high: 1, medium: 1, plain: 1 });
    expect(plan.titles).toContain('买菜');
    expect(plan.titles).not.toContain('已完成');
  });

  it('caps the brief and hides all-day times', () => {
    const tasks = Array.from({ length: 6 }, (_, index) =>
      task({ id: `t${index}`, title: `事项${index}`, priority: 0, isAllDay: true, dueAt: '2026-10-14T16:00:00.000Z' }),
    );
    const plan = buildTodayPlan(tasks, zone, now);
    expect(plan.items).toHaveLength(5);
    expect(plan.items.every((item) => item.when === null)).toBe(true);
    expect(plan.rest).toBe(1);
    expect(plan.counts.urgent).toBe(6);
  });

  it('does not repeat unmarked titles', () => {
    const plan = buildTodayPlan(
      [task({ id: 'a', title: '买菜' }), task({ id: 'b', title: '写周报', priority: 3 })],
      zone,
      now,
    );
    expect(plan.items).toEqual([]);
    expect(plan.rest).toBe(2);
    expect(plan.counts.plain).toBe(2);
  });

  it('hides a note that only restates titles', () => {
    const titles = ['写周报', '回客户'];
    expect(noteRepeatsTasks('今天要做：写周报、回客户', titles)).toBe(true);
    expect(noteRepeatsTasks('写周报被下午的会卡住，可以改到晚上', titles)).toBe(false);
    expect(noteRepeatsTasks('下午有空档，适合处理需要连续时间的事', titles)).toBe(false);
  });

  it('includes priority in the facts the layout agent sees', () => {
    const text = describeTodayLayoutFacts({
      timezone: zone,
      localNow: '2026-10-14 12:00',
      openTasks: [{ title: '回客户', due: null, overdue: false, priority: 0 }],
      upcoming: [],
      holidayName: '元旦',
      holidayDate: '2027-01-01',
      weather: '无',
      meetings: '无',
      recommendations: [],
      quiet: false,
      habits: [],
      memory: [],
    });
    expect(text).toContain('回客户（紧急）');
  });
});
