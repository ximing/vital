import { describe, expect, it } from 'vitest';
import {
  computeNow,
  continuousMinutes,
  type NowEngineInput,
  type NowEngineTask,
} from '../../src/outcomes/now-engine.js';

const TZ = 'Asia/Shanghai';
// 2026-09-10 14:10 local.
const NOW = new Date('2026-09-10T06:10:00Z');

function task(over: Partial<NowEngineTask> & Pick<NowEngineTask, 'id' | 'title'>): NowEngineTask {
  return {
    status: 'todo',
    priority: 3,
    estimateMinutes: null,
    dueAt: null,
    isAllDay: true,
    outcomeId: null,
    outcomeSignal: null,
    ...over,
  };
}

function input(over: Partial<NowEngineInput> = {}): NowEngineInput {
  return {
    now: NOW,
    timezone: TZ,
    tasks: [],
    habitWindows: [],
    quietHoursStart: null,
    quietHoursEnd: null,
    ...over,
  };
}

describe('continuousMinutes', () => {
  it('is bounded by the end of the local day by default', () => {
    // 14:10 → next midnight = 9h50m.
    expect(continuousMinutes(input())).toBe(590);
  });

  it('is bounded by the end of a habit window that contains now', () => {
    expect(continuousMinutes(input({ habitWindows: [{ start: '14:00', end: '15:00' }] }))).toBe(
      50,
    );
  });

  it('ignores habit windows that do not contain now', () => {
    expect(
      continuousMinutes(
        input({ habitWindows: [{ start: '08:00', end: '09:00' }, { start: '18:00', end: '19:00' }] }),
      ),
    ).toBe(590);
  });

  it('is bounded by the next quiet-hours start', () => {
    expect(
      continuousMinutes(input({ quietHoursStart: '15:00', quietHoursEnd: '07:00' })),
    ).toBe(50);
  });

  it('handles overnight habit windows past midnight', () => {
    // 23:10 local, window 22:00–01:00: day end (00:00) is the nearest boundary.
    const late = new Date('2026-09-10T15:10:00Z');
    expect(
      continuousMinutes(input({ now: late, habitWindows: [{ start: '22:00', end: '01:00' }] })),
    ).toBe(50);
    // 00:30 local the next day, same window: it ends at 01:00, before day end.
    const pastMidnight = new Date('2026-09-10T16:30:00Z');
    expect(
      continuousMinutes(
        input({ now: pastMidnight, habitWindows: [{ start: '22:00', end: '01:00' }] }),
      ),
    ).toBe(30);
  });
});

describe('computeNow quiet hours', () => {
  it('suppresses recommendations inside quiet hours with a resume hint', () => {
    // 23:10 local, quiet 22:00–07:00 (overnight → resumes tomorrow).
    const late = new Date('2026-09-10T15:10:00Z');
    const result = computeNow(
      input({
        now: late,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        tasks: [task({ id: 'a', title: '改简历' })],
      }),
    );
    expect(result.quiet).toBe(true);
    expect(result.recommendations).toEqual([]);
    expect(result.reason).toContain('静默');
    expect(result.reason).toContain('明天 07:00');
  });

  it('hints at a same-day resume when quiet hours end later today', () => {
    // 13:00 local, quiet 12:00–14:00.
    const noon = new Date('2026-09-10T05:00:00Z');
    const result = computeNow(
      input({ now: noon, quietHoursStart: '12:00', quietHoursEnd: '14:00' }),
    );
    expect(result.quiet).toBe(true);
    expect(result.reason).toContain('14:00 后再来看看');
    expect(result.reason).not.toContain('明天');
  });
});

describe('computeNow empty states', () => {
  it('reads as a free day when there are no open tasks', () => {
    const result = computeNow(input());
    expect(result.quiet).toBe(false);
    expect(result.recommendations).toEqual([]);
    expect(result.reason).toBe('今天没有待办，留一点时间给自己。');
  });

  it('ignores done and canceled tasks for the empty check', () => {
    const result = computeNow(
      input({
        tasks: [
          task({ id: 'a', title: '已完成', status: 'done' }),
          task({ id: 'b', title: '已取消', status: 'canceled' }),
        ],
      }),
    );
    expect(result.recommendations).toEqual([]);
    expect(result.reason).toBe('今天没有待办，留一点时间给自己。');
  });

  it('says the slot is too short when nothing fits', () => {
    const result = computeNow(
      input({
        habitWindows: [{ start: '14:00', end: '14:15' }],
        tasks: [task({ id: 'a', title: '长任务', estimateMinutes: 40 })],
      }),
    );
    expect(result.continuousMinutes).toBe(5);
    expect(result.recommendations).toEqual([]);
    expect(result.reason).toBe('只剩 5 分钟，暂时没有能从容完成的任务。');
  });
});

describe('computeNow recommendations', () => {
  it('filters out tasks whose estimate exceeds the continuous slot', () => {
    const result = computeNow(
      input({
        habitWindows: [{ start: '14:00', end: '14:30' }],
        tasks: [
          task({ id: 'long', title: '太长', estimateMinutes: 40 }),
          task({ id: 'fit', title: '刚好', estimateMinutes: 20 }),
          task({ id: 'free', title: '未估时' }),
        ],
      }),
    );
    expect(result.continuousMinutes).toBe(20);
    expect(result.recommendations.map((r) => r.taskId)).toEqual(['fit', 'free']);
  });

  it('ranks alert threads above flat, then priority, then due urgency', () => {
    const result = computeNow(
      input({
        tasks: [
          task({ id: 'flat', title: '平稳线程', outcomeSignal: 'flat' }),
          task({ id: 'alert', title: '告警线程', outcomeSignal: 'alert' }),
          task({ id: 'alert-p0', title: '告警加急', outcomeSignal: 'alert', priority: 0 }),
          task({ id: 'up', title: '在推进', outcomeSignal: 'up' }),
        ],
      }),
    );
    expect(result.recommendations.map((r) => r.taskId)).toEqual(['alert-p0', 'alert']);
  });

  it('breaks score ties by earlier due date, then task id', () => {
    const sooner = new Date('2026-09-12T00:00:00Z');
    const later = new Date('2026-09-13T00:00:00Z');
    const result = computeNow(
      input({
        tasks: [
          task({ id: 'b', title: '晚截止', dueAt: later }),
          task({ id: 'a', title: '早截止', dueAt: sooner }),
        ],
      }),
    );
    expect(result.recommendations.map((r) => r.taskId)).toEqual(['a', 'b']);
  });

  it('keeps at most two recommendations', () => {
    const result = computeNow(
      input({
        tasks: [
          task({ id: 'a', title: '一' }),
          task({ id: 'b', title: '二' }),
          task({ id: 'c', title: '三' }),
        ],
      }),
    );
    expect(result.recommendations).toHaveLength(2);
    expect(result.reason).toBe('任选一件开始，两件都是候选，不必按顺序。');
  });

  it('flags tasks due today or overdue as dueSoon', () => {
    const dueToday = new Date('2026-09-10T12:00:00Z'); // 20:00 local, same day
    const overdue = new Date('2026-09-10T02:00:00Z'); // 10:00 local, passed
    const future = new Date('2026-09-12T00:00:00Z');
    const result = computeNow(
      input({
        tasks: [
          task({ id: 'today', title: '今天到期', dueAt: dueToday, isAllDay: false, outcomeSignal: 'alert' }),
          task({ id: 'overdue', title: '已逾期', dueAt: overdue, isAllDay: false, outcomeSignal: 'alert' }),
        ],
      }),
    );
    const byId = new Map(result.recommendations.map((r) => [r.taskId, r]));
    expect(byId.get('today')?.dueSoon).toBe(true);
    expect(byId.get('overdue')?.dueSoon).toBe(true);

    const futureOnly = computeNow(
      input({ tasks: [task({ id: 'future', title: '后天', dueAt: future })] }),
    );
    expect(futureOnly.recommendations[0]?.dueSoon).toBe(false);
  });

  it('carries the task fields the card renders', () => {
    const result = computeNow(
      input({
        tasks: [
          task({
            id: 'a',
            title: '简历最后一轮校对',
            estimateMinutes: 40,
            outcomeId: 'o1',
            outcomeSignal: 'up',
          }),
        ],
      }),
    );
    expect(result.recommendations[0]).toMatchObject({
      taskId: 'a',
      title: '简历最后一轮校对',
      estimateMinutes: 40,
      outcomeId: 'o1',
      dueSoon: false,
    });
  });
});
