import { describe, expect, it } from 'vitest';
import {
  busyBlock,
  clipWorkWindow,
  isScheduleRequest,
  proposeSchedule,
  slotMinutes,
  type ScheduleWindow,
} from '../../src/agent/schedule-proposal.js';

const ZONE = 'Asia/Shanghai';
const DAY = '2026-10-15';
const WORK: ScheduleWindow = { startMin: 9 * 60, endMin: 18 * 60 };

function at(hhmm: string): Date {
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 15, (hour ?? 0) - 8, minute ?? 0));
}

describe('schedule gaps', () => {
  it('cuts busy blocks out of the work window and keeps the earlier gap', () => {
    const placed = proposeSchedule({
      window: WORK,
      dayCapMinutes: 540,
      busy: [
        { startMin: 10 * 60, endMin: 11 * 60 },
        { startMin: 9 * 60 + 30, endMin: 10 * 60 + 30 },
      ],
      candidates: [{ id: 'a', title: '写方案', minutes: 30, priority: 1 }],
    });
    expect(placed.placed).toEqual([
      { id: 'a', title: '写方案', startMin: 9 * 60, endMin: 9 * 60 + 30 },
    ]);
    expect(placed.unplaced).toEqual([]);
  });

  it('uses calendar end when start and due are the same instant', () => {
    const block = busyBlock(
      {
        isAllDay: false,
        startAt: at('09:00'),
        dueAt: at('09:00'),
        calendarEndAt: at('17:30'),
      },
      ZONE,
      DAY,
    );
    expect(block).toEqual({ startMin: 9 * 60, endMin: 17 * 60 + 30 });
  });

  it('ignores all-day rows and zero-length calendar points', () => {
    expect(
      busyBlock({ isAllDay: true, startAt: at('09:00'), dueAt: at('18:00'), calendarEndAt: null }, ZONE, DAY),
    ).toBeNull();
    expect(
      busyBlock({ isAllDay: false, startAt: at('09:00'), dueAt: at('09:00'), calendarEndAt: null }, ZONE, DAY),
    ).toBeNull();
  });

  it('uses dueAt as the end when a manual row has a real span', () => {
    expect(
      busyBlock({ isAllDay: false, startAt: at('14:00'), dueAt: at('15:00'), calendarEndAt: null }, ZONE, DAY),
    ).toEqual({ startMin: 14 * 60, endMin: 15 * 60 });
  });

  it('defaults a missing estimate to 30 minutes', () => {
    expect(slotMinutes(null)).toBe(30);
    expect(slotMinutes(0)).toBe(30);
    expect(slotMinutes(45)).toBe(45);
  });

  it('places the higher priority into the only gap and keeps the rest as 放不下', () => {
    const result = proposeSchedule({
      window: WORK,
      dayCapMinutes: 540,
      busy: [{ startMin: 9 * 60, endMin: 17 * 60 + 30 }],
      candidates: [
        { id: 'long', title: '整理材料', minutes: 90, priority: 2 },
        { id: 'mail', title: '回邮件', minutes: 30, priority: 1 },
        { id: 'write', title: '写方案', minutes: 30, priority: 0 },
      ],
    });
    expect(result.placed).toEqual([
      { id: 'write', title: '写方案', startMin: 17 * 60 + 30, endMin: 18 * 60 },
    ]);
    expect(result.unplaced).toEqual([
      { id: 'mail', title: '回邮件', reason: '放不下' },
      { id: 'long', title: '整理材料', reason: '放不下' },
    ]);
  });

  it('stops at the daily cap even when a later gap exists', () => {
    const result = proposeSchedule({
      window: WORK,
      dayCapMinutes: 30,
      busy: [],
      candidates: [
        { id: 'a', title: '先做', minutes: 30, priority: 0 },
        { id: 'b', title: '后做', minutes: 30, priority: 1 },
      ],
    });
    expect(result.placed.map((item) => item.id)).toEqual(['a']);
    expect(result.unplaced).toEqual([{ id: 'b', title: '后做', reason: '放不下' }]);
  });

  it('tries a preferred window first and falls back to the work window', () => {
    const preferred = proposeSchedule({
      window: WORK,
      dayCapMinutes: 540,
      busy: [],
      preferred: [{ startMin: 14 * 60, endMin: 15 * 60 }],
      candidates: [{ id: 'a', title: '写', minutes: 30, priority: 0 }],
    });
    expect(preferred.placed[0]?.startMin).toBe(14 * 60);
    const fallback = proposeSchedule({
      window: WORK,
      dayCapMinutes: 540,
      busy: [{ startMin: 14 * 60, endMin: 15 * 60 }],
      preferred: [{ startMin: 14 * 60, endMin: 15 * 60 }],
      candidates: [{ id: 'a', title: '写', minutes: 30, priority: 0 }],
    });
    expect(fallback.placed[0]?.startMin).toBe(9 * 60);
  });

  it('clips morning and afternoon inside the work window', () => {
    expect(clipWorkWindow(9 * 60, 18 * 60, 'morning')).toEqual({ startMin: 9 * 60, endMin: 12 * 60 });
    expect(clipWorkWindow(9 * 60, 18 * 60, 'afternoon')).toEqual({ startMin: 12 * 60, endMin: 18 * 60 });
    expect(clipWorkWindow(13 * 60, 18 * 60, 'morning')).toBeNull();
  });

  it('recognizes a schedule request without stealing a plain reorder', () => {
    expect(isScheduleRequest('帮我把这几件塞进周四')).toBe(true);
    expect(isScheduleRequest('明天上午帮我安排写方案的时间')).toBe(true);
    expect(isScheduleRequest('排一下周四的待办')).toBe(true);
    expect(isScheduleRequest('帮我排下周三前的任务')).toBe(false);
  });
});
