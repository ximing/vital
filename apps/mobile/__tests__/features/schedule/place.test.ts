import { describe, expect, it } from 'vitest';
import {
  monthCellPreview,
  placeSchedule,
  scheduleRangeIso,
  shiftScheduleCursor,
  type MonthPlacement,
  type ScheduleOccurrence,
  type WeekPlacement,
} from '../../../src/features/schedule/place';
import { zonedLocalMidnightIso, zonedWallTimeIso } from '../../../src/features/schedule/time';

const ZONE = 'Asia/Shanghai';

function at(
  taskId: string,
  title: string,
  occurrenceAt: string,
  isAllDay: boolean,
  endsAt: string | null = null,
  extra: Partial<ScheduleOccurrence> = {},
): ScheduleOccurrence {
  return { taskId, title, occurrenceAt, isAllDay, endsAt, ...extra };
}

function asWeek(placed: ReturnType<typeof placeSchedule>): WeekPlacement {
  if (placed.view === 'month') throw new Error('expected a time grid');
  return placed;
}

function asMonth(placed: ReturnType<typeof placeSchedule>): MonthPlacement {
  if (placed.view !== 'month') throw new Error('expected a month');
  return placed;
}

describe('mobile schedule placement', () => {
  it('uses the account timezone for week bounds and local hours', () => {
    const week = asWeek(
      placeSchedule({
        occurrences: [
          at('meet', '晨会', '2026-10-30T01:00:00.000Z', false),
          at('all', '全天读书', '2026-10-29T16:00:00.000Z', true),
        ],
        timeZone: ZONE,
        weekStartsOn: 1,
        cursorYmd: '2026-10-30',
        view: 'week',
      }),
    );
    expect(week.startYmd).toBe('2026-10-26');
    expect(week.endYmd).toBe('2026-11-01');
    expect(week.days).toHaveLength(7);
    const friday = week.days.find((day) => day.ymd === '2026-10-30');
    expect(friday?.hours[9]?.items.map((item) => item.title)).toEqual(['晨会']);
    expect(friday?.allDay.map((item) => item.title)).toEqual(['全天读书']);
    expect(zonedWallTimeIso('2026-10-30', '09:00:00', ZONE)).toBe('2026-10-30T01:00:00.000Z');
    expect(zonedLocalMidnightIso('2026-10-30', ZONE)).toBe('2026-10-29T16:00:00.000Z');
  });

  it('draws one column for the day view and asks the calendar for that day', () => {
    const day = asWeek(
      placeSchedule({
        occurrences: [],
        timeZone: ZONE,
        weekStartsOn: 1,
        cursorYmd: '2026-10-30',
        view: 'day',
      }),
    );
    expect(day.view).toBe('day');
    expect(day.days.map((column) => column.ymd)).toEqual(['2026-10-30']);
    const range = scheduleRangeIso('2026-10-30', 'day', 1, ZONE);
    expect(range.from).toBe(zonedLocalMidnightIso('2026-10-30', ZONE));
    expect(new Date(range.to).getTime()).toBe(
      new Date(zonedLocalMidnightIso('2026-10-31', ZONE)).getTime() - 1,
    );
    expect(shiftScheduleCursor('2026-10-30', 'day', 1)).toBe('2026-10-31');
    expect(shiftScheduleCursor('2026-10-30', 'week', -1)).toBe('2026-10-23');
    expect(shiftScheduleCursor('2026-10-30', 'month', 1)).toBe('2026-11-30');
  });

  it('draws a timed block from start through end, including across midnight', () => {
    const placed = asWeek(
      placeSchedule({
        occurrences: [
          at('span', '评审', '2026-10-30T06:00:00.000Z', false, '2026-10-30T08:00:00.000Z'),
          at('night', '跨夜', '2026-10-30T15:00:00.000Z', false, '2026-10-30T17:00:00.000Z'),
        ],
        timeZone: ZONE,
        weekStartsOn: 1,
        cursorYmd: '2026-10-30',
        view: 'week',
      }),
    );
    const friday = placed.days.find((day) => day.ymd === '2026-10-30');
    const saturday = placed.days.find((day) => day.ymd === '2026-10-31');
    expect(friday?.blocks.map((block) => [block.title, block.startMinute, block.endMinute])).toEqual([
      ['评审', 14 * 60, 16 * 60],
      ['跨夜', 23 * 60, 24 * 60],
    ]);
    expect(friday?.hours[14]?.items).toEqual([]);
    expect(saturday?.blocks.map((block) => [block.title, block.startMinute, block.endMinute, block.resizeStart])).toEqual([
      ['跨夜', 0, 60, false],
    ]);
    expect(friday?.blocks[1]?.resizeEnd).toBe(false);
    expect(saturday?.blocks[0]?.resizeEnd).toBe(true);
  });

  it('places a point beside a span instead of under it', () => {
    const placed = asWeek(
      placeSchedule({
        occurrences: [
          at('span', '评审', '2026-10-30T06:00:00.000Z', false, '2026-10-30T08:00:00.000Z'),
          at('talk', 'Shopee 面试', '2026-10-30T06:00:00.000Z', false),
          at('later', '稍后', '2026-10-30T08:00:00.000Z', false),
        ],
        timeZone: ZONE,
        weekStartsOn: 1,
        cursorYmd: '2026-10-30',
        view: 'week',
      }),
    );
    const friday = placed.days.find((day) => day.ymd === '2026-10-30');
    const span = friday?.blocks.find((block) => block.title === '评审');
    const point = friday?.blocks.find((block) => block.title === 'Shopee 面试');
    expect(span?.laneCount).toBe(2);
    expect(point?.laneCount).toBe(2);
    expect(point?.lane).not.toBe(span?.lane);
    expect(point?.resizeStart).toBe(false);
    expect(point?.resizeEnd).toBe(false);
    expect(point?.startMinute).toBe(14 * 60);
    expect(point?.endMinute).toBe(14 * 60 + 15);
    expect(friday?.hours[14]?.items).toEqual([]);
    expect(friday?.hours[16]?.items.map((item) => item.title)).toEqual(['稍后']);
  });

  it('keeps a point as a chip and locks a device-calendar mirror', () => {
    const placed = asWeek(
      placeSchedule({
        occurrences: [
          at('point', '九点', '2026-10-30T01:00:00.000Z', false, null),
          at('mirror', '来自日历', '2026-10-30T02:00:00.000Z', false, '2026-10-30T03:00:00.000Z', {
            locked: true,
          }),
        ],
        timeZone: ZONE,
        weekStartsOn: 1,
        cursorYmd: '2026-10-30',
        view: 'day',
      }),
    );
    const friday = placed.days[0];
    expect(friday?.hours[9]?.items.map((item) => item.title)).toEqual(['九点']);
    expect(friday?.blocks.map((block) => [block.title, block.locked])).toEqual([['来自日历', true]]);
  });

  it('lists habits after other tasks and keeps overflow behind a preview', () => {
    const titles = ['甲', '乙', '丙', '丁'];
    const month = asMonth(
      placeSchedule({
        occurrences: [
          at('habit', '习惯', '2026-10-30T01:00:00.000Z', false, null, { habit: true }),
          ...titles.map((title, index) =>
            at(`t${index}`, title, `2026-10-30T0${index}:00:00.000Z`, index === 0),
          ),
        ],
        timeZone: ZONE,
        weekStartsOn: 1,
        cursorYmd: '2026-10-30',
        view: 'month',
      }),
    );
    const chips = month.cells.find((cell) => cell.ymd === '2026-10-30')?.chips ?? [];
    expect(chips.map((chip) => chip.title)).toEqual(['甲', '乙', '丙', '丁', '习惯']);
    expect(chips[0]?.isAllDay).toBe(true);
    const preview = monthCellPreview(chips);
    expect(preview.shown.map((chip) => chip.title)).toEqual(['甲', '乙']);
    expect(preview.hidden.map((chip) => chip.title)).toEqual(['丙', '丁', '习惯']);
  });
});
