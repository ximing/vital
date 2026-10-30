import { describe, expect, it } from 'vitest';
import { formatYmd } from '../../../src/features/todos/model';
import {
  placeSchedule,
  scheduleRangeIso,
  shiftScheduleCursor,
  type MonthPlacement,
  type ScheduleOccurrence,
  type WeekPlacement,
} from '../../../src/features/schedule/place';

const ZONE = 'Asia/Shanghai';

function at(
  taskId: string,
  title: string,
  occurrenceAt: string,
  isAllDay: boolean,
): ScheduleOccurrence {
  return { taskId, title, occurrenceAt, isAllDay };
}

const occurrences: ScheduleOccurrence[] = [
  at('timed-9', '晨会', '2026-10-30T01:00:00.000Z', false),
  at('timed-930', '站会', '2026-10-30T01:30:00.000Z', false),
  at('timed-21', '晚间', '2026-10-30T13:00:00.000Z', false),
  at('midnight', '零点', '2026-10-29T16:00:00.000Z', false),
  at('all-day', '全天读书', '2026-10-29T16:00:00.000Z', true),
  at('outside', '上周', '2026-10-25T01:00:00.000Z', false),
  at('next-local-day', '次日凌晨', '2026-10-30T16:30:00.000Z', false),
];

function weekOf(): WeekPlacement {
  const placed = placeSchedule({
    occurrences,
    timeZone: ZONE,
    weekStartsOn: 1,
    cursorYmd: '2026-10-30',
    view: 'week',
  });
  if (placed.view !== 'week') throw new Error('expected week');
  return placed;
}

function monthOf(timeZone = ZONE, cursorYmd = '2026-10-30'): MonthPlacement {
  const placed = placeSchedule({
    occurrences,
    timeZone,
    weekStartsOn: 1,
    cursorYmd,
    view: 'month',
  });
  if (placed.view !== 'month') throw new Error('expected month');
  return placed;
}

describe('placeSchedule', () => {
  it('puts timed hours, an all-day band, and overlapping titles on the local week', () => {
    const week = weekOf();
    expect(week.days).toHaveLength(7);
    expect(week.startYmd).toBe('2026-10-26');
    expect(week.endYmd).toBe('2026-11-01');
    for (const day of week.days) {
      expect(day.hours.map((slot) => slot.hour)).toEqual(
        Array.from({ length: 24 }, (_, hour) => hour),
      );
    }

    const friday = week.days.find((day) => day.ymd === '2026-10-30');
    expect(friday).toBeDefined();
    expect(friday?.hours[9]?.items.map((item) => item.title)).toEqual(['晨会', '站会']);
    expect(friday?.hours[21]?.items.map((item) => item.title)).toEqual(['晚间']);
    expect(friday?.hours[9]?.items.map((item) => item.title)).not.toContain('晚间');
    expect(friday?.hours[0]?.items.map((item) => item.title)).toEqual(['零点']);
    expect(friday?.allDay.map((item) => item.title)).toEqual(['全天读书']);
    expect(friday?.hours[0]?.items.map((item) => item.title)).not.toContain('全天读书');
    expect(week.days.flatMap((day) => day.allDay.map((item) => item.title))).not.toContain('零点');
    expect(
      week.days.flatMap((day) => [
        ...day.allDay.map((item) => item.title),
        ...day.hours.flatMap((slot) => slot.items.map((item) => item.title)),
      ]),
    ).not.toContain('上周');
  });

  it('starts the week on Sunday when the account does', () => {
    const placed = placeSchedule({
      occurrences: [],
      timeZone: ZONE,
      weekStartsOn: 0,
      cursorYmd: '2026-10-30',
      view: 'week',
    });
    if (placed.view !== 'week') throw new Error('expected week');
    expect(placed.days.map((day) => day.ymd)).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
    expect(placed.days[0]?.hours).toHaveLength(24);
  });

  it('puts each title on its local month date, not the UTC date', () => {
    const month = monthOf();
    expect(month.year).toBe(2026);
    expect(month.month).toBe(10);
    expect(month.cells).toHaveLength(42);

    const titlesOn = (ymd: string) =>
      month.cells.find((cell) => cell.ymd === ymd)?.chips.map((chip) => chip.title) ?? [];

    expect(titlesOn('2026-10-30')).toEqual(['全天读书', '零点', '晨会', '站会', '晚间']);
    expect(titlesOn('2026-10-29')).not.toContain('全天读书');
    expect(titlesOn('2026-10-29')).not.toContain('零点');
    expect(titlesOn('2026-10-31')).toEqual(['次日凌晨']);
    expect(titlesOn('2026-10-30')).not.toContain('次日凌晨');
    expect(titlesOn('2026-10-25')).toEqual(['上周']);

    const losAngeles = placeSchedule({
      occurrences: [at('la', '洛杉矶傍晚', '2026-10-30T01:00:00.000Z', false)],
      timeZone: 'America/Los_Angeles',
      weekStartsOn: 1,
      cursorYmd: '2026-10-29',
      view: 'week',
    });
    if (losAngeles.view !== 'week') throw new Error('expected week');
    const thursday = losAngeles.days.find((day) => day.ymd === '2026-10-29');
    expect(thursday?.hours[18]?.items.map((item) => item.title)).toEqual(['洛杉矶傍晚']);
    expect(thursday?.hours[1]?.items).toEqual([]);
    expect(losAngeles.days.find((day) => day.ymd === '2026-10-30')?.hours[1]?.items).toEqual([]);
  });

  it('still builds an empty week and month grid', () => {
    const week = placeSchedule({
      occurrences: [],
      timeZone: ZONE,
      weekStartsOn: 1,
      cursorYmd: '2026-10-30',
      view: 'week',
    });
    const month = placeSchedule({
      occurrences: [],
      timeZone: ZONE,
      weekStartsOn: 1,
      cursorYmd: '2026-10-30',
      view: 'month',
    });
    if (week.view !== 'week' || month.view !== 'month') throw new Error('expected both grids');
    expect(week.days).toHaveLength(7);
    expect(
      week.days.every(
        (day) => day.allDay.length === 0 && day.hours.every((slot) => slot.items.length === 0),
      ),
    ).toBe(true);
    expect(month.cells).toHaveLength(42);
    expect(month.cells.some((cell) => cell.inMonth && cell.ymd === '2026-10-01')).toBe(true);
    expect(month.cells.some((cell) => !cell.inMonth)).toBe(true);
    expect(month.cells.every((cell) => cell.chips.length === 0)).toBe(true);
  });

  it('covers the visible local window and steps a week or a month', () => {
    const range = scheduleRangeIso('2026-10-30', 'week', 1, ZONE);
    expect(formatYmd(new Date(range.from), ZONE)).toBe('2026-10-26');
    expect(formatYmd(new Date(range.to), ZONE)).toBe('2026-11-01');
    const month = scheduleRangeIso('2026-10-30', 'month', 1, ZONE);
    expect(formatYmd(new Date(month.from), ZONE) <= '2026-10-01').toBe(true);
    expect(formatYmd(new Date(month.to), ZONE) >= '2026-10-31').toBe(true);

    expect(shiftScheduleCursor('2026-10-30', 'week', 1)).toBe('2026-11-06');
    expect(shiftScheduleCursor('2026-10-30', 'week', -1)).toBe('2026-10-23');
    expect(shiftScheduleCursor('2026-10-30', 'month', 1)).toBe('2026-11-30');
    expect(shiftScheduleCursor('2026-10-30', 'month', -1)).toBe('2026-09-30');
  });
});
