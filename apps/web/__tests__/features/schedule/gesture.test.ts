import { describe, expect, it } from 'vitest';
import {
  scheduleDraftFromRange,
  scheduleGestureRange,
  scheduleRangeHitsCell,
  scheduleRangeLabel,
  type ScheduleCreateRange,
  type SlotMinute,
} from '../../../src/features/schedule/gesture';

const ZONE = 'Asia/Shanghai';

function at(isoWithOffset: string): string {
  return new Date(isoWithOffset).toISOString();
}

function timed(
  downHour: number,
  downMinute: SlotMinute,
  upHour: number,
  upMinute: SlotMinute,
  upYmd = '2026-10-30',
): ScheduleCreateRange {
  const range = scheduleGestureRange(
    { kind: 'hour', ymd: '2026-10-30', hour: downHour, minute: downMinute },
    { kind: 'hour', ymd: upYmd, hour: upHour, minute: upMinute },
    ZONE,
  );
  if (range === null) throw new Error('expected a timed range');
  return range;
}

describe('scheduleGestureRange', () => {
  it('selects the pressed 15-minute slot on that column', () => {
    const range = timed(9, 0, 9, 0);
    expect(range).toMatchObject({
      kind: 'timed',
      ymd: '2026-10-30',
      startHour: 9,
      startMinute: 0,
      endHour: 9,
      endMinute: 0,
      isAllDay: false,
      startAt: at('2026-10-30T09:00:00+08:00'),
      dueAt: at('2026-10-30T09:15:00+08:00'),
    });
    expect(range.startAt).not.toBe('2026-10-30T09:00:00.000Z');
    expect(scheduleRangeLabel(range)).toBe('10月30日 09:00 – 09:15');
    expect(
      scheduleRangeHitsCell(range, { kind: 'hour', ymd: '2026-10-30', hour: 9, minute: 0 }),
    ).toBe(true);
    expect(
      scheduleRangeHitsCell(range, { kind: 'hour', ymd: '2026-10-30', hour: 9, minute: 15 }),
    ).toBe(false);
    expect(
      scheduleRangeHitsCell(range, { kind: 'hour', ymd: '2026-10-31', hour: 9, minute: 0 }),
    ).toBe(false);
  });

  it('extends downward through the end of the later 15-minute slot', () => {
    const range = timed(9, 15, 9, 45);
    expect(range).toMatchObject({
      kind: 'timed',
      ymd: '2026-10-30',
      startHour: 9,
      startMinute: 15,
      endHour: 9,
      endMinute: 45,
      isAllDay: false,
      startAt: at('2026-10-30T09:15:00+08:00'),
      dueAt: at('2026-10-30T10:00:00+08:00'),
    });
    expect(scheduleRangeLabel(range)).toBe('10月30日 09:15 – 10:00');
    for (const minute of [15, 30, 45] as const) {
      expect(
        scheduleRangeHitsCell(range, { kind: 'hour', ymd: '2026-10-30', hour: 9, minute }),
      ).toBe(true);
    }
    expect(
      scheduleRangeHitsCell(range, { kind: 'hour', ymd: '2026-10-30', hour: 9, minute: 0 }),
    ).toBe(false);
    expect(
      scheduleRangeHitsCell(range, { kind: 'hour', ymd: '2026-10-30', hour: 10, minute: 0 }),
    ).toBe(false);
    expect(scheduleDraftFromRange(range)).toMatchObject({
      mode: 'range',
      startYmd: '2026-10-30',
      endYmd: '2026-10-30',
      startHm: '09:15',
      endHm: '10:00',
    });
  });

  it('extends upward and keeps the pressed column when the pointer slides sideways', () => {
    const range = timed(14, 0, 10, 30, '2026-11-02');
    expect(range).toMatchObject({
      kind: 'timed',
      ymd: '2026-10-30',
      startHour: 10,
      startMinute: 30,
      endHour: 14,
      endMinute: 0,
      isAllDay: false,
      startAt: at('2026-10-30T10:30:00+08:00'),
      dueAt: at('2026-10-30T14:15:00+08:00'),
    });
    expect(scheduleRangeLabel(range)).toBe('10月30日 10:30 – 14:15');
    expect(
      scheduleRangeHitsCell(range, { kind: 'hour', ymd: '2026-10-30', hour: 10, minute: 30 }),
    ).toBe(true);
    expect(
      scheduleRangeHitsCell(range, { kind: 'hour', ymd: '2026-10-30', hour: 14, minute: 0 }),
    ).toBe(true);
    expect(
      scheduleRangeHitsCell(range, { kind: 'hour', ymd: '2026-10-30', hour: 10, minute: 15 }),
    ).toBe(false);
    expect(
      scheduleRangeHitsCell(range, { kind: 'hour', ymd: '2026-11-02', hour: 10, minute: 30 }),
    ).toBe(false);
    expect(scheduleRangeHitsCell(range, { kind: 'day', ymd: '2026-10-30' })).toBe(false);
  });

  it('ends a 23:45 selection at the next local midnight and stays timed', () => {
    const click = timed(23, 45, 23, 45);
    expect(click).toMatchObject({
      kind: 'timed',
      ymd: '2026-10-30',
      startHour: 23,
      startMinute: 45,
      endHour: 23,
      endMinute: 45,
      isAllDay: false,
      startAt: at('2026-10-30T23:45:00+08:00'),
      dueAt: at('2026-10-31T00:00:00+08:00'),
    });
    expect(scheduleRangeLabel(click)).toBe('10月30日 23:45 – 10月31日 00:00');
    expect(scheduleDraftFromRange(click)).toMatchObject({
      startYmd: '2026-10-30',
      endYmd: '2026-10-31',
      startHm: '23:45',
      endHm: '00:00',
    });

    const dragged = timed(23, 0, 23, 30);
    expect(dragged).toMatchObject({
      startHour: 23,
      startMinute: 0,
      endHour: 23,
      endMinute: 30,
      isAllDay: false,
      startAt: at('2026-10-30T23:00:00+08:00'),
      dueAt: at('2026-10-30T23:45:00+08:00'),
    });
  });

  it('uses the zone argument for the instants', () => {
    const range = scheduleGestureRange(
      { kind: 'hour', ymd: '2026-10-30', hour: 9, minute: 15 },
      { kind: 'hour', ymd: '2026-10-30', hour: 9, minute: 15 },
      'America/Los_Angeles',
    );
    expect(range).toMatchObject({
      startAt: at('2026-10-30T09:15:00-07:00'),
      dueAt: at('2026-10-30T09:30:00-07:00'),
      isAllDay: false,
    });
  });

  it('selects one all-day cell, or the closed date interval in either drag direction', () => {
    const one = scheduleGestureRange(
      { kind: 'day', ymd: '2026-10-30' },
      { kind: 'day', ymd: '2026-10-30' },
      ZONE,
    );
    expect(one).toMatchObject({
      kind: 'allDay',
      startYmd: '2026-10-30',
      endYmd: '2026-10-30',
      isAllDay: true,
      startAt: at('2026-10-30T00:00:00+08:00'),
      dueAt: at('2026-10-30T00:00:00+08:00'),
    });
    expect(scheduleRangeLabel(one!)).toBe('10月30日');
    expect(scheduleDraftFromRange(one!)).toMatchObject({
      mode: 'range',
      startYmd: '2026-10-30',
      endYmd: '2026-10-30',
      startHm: null,
      endHm: null,
    });
    expect(scheduleRangeHitsCell(one!, { kind: 'day', ymd: '2026-10-30' })).toBe(true);
    expect(scheduleRangeHitsCell(one!, { kind: 'day', ymd: '2026-10-31' })).toBe(false);

    const span = scheduleGestureRange(
      { kind: 'day', ymd: '2026-11-02' },
      { kind: 'day', ymd: '2026-10-30' },
      ZONE,
    );
    expect(span).toMatchObject({
      kind: 'allDay',
      startYmd: '2026-10-30',
      endYmd: '2026-11-02',
      isAllDay: true,
      startAt: at('2026-10-30T00:00:00+08:00'),
      dueAt: at('2026-11-02T00:00:00+08:00'),
    });
    expect(scheduleRangeLabel(span!)).toBe('10月30日 – 11月2日');
    expect(scheduleRangeHitsCell(span!, { kind: 'day', ymd: '2026-10-30' })).toBe(true);
    expect(scheduleRangeHitsCell(span!, { kind: 'day', ymd: '2026-10-31' })).toBe(true);
    expect(scheduleRangeHitsCell(span!, { kind: 'day', ymd: '2026-11-02' })).toBe(true);
    expect(scheduleRangeHitsCell(span!, { kind: 'day', ymd: '2026-10-29' })).toBe(false);
    expect(scheduleRangeHitsCell(span!, { kind: 'day', ymd: '2026-11-03' })).toBe(false);
    expect(
      scheduleRangeHitsCell(span!, { kind: 'hour', ymd: '2026-10-30', hour: 0, minute: 0 }),
    ).toBe(false);
  });

  it('keeps a month cell outside the shown month on its own date', () => {
    const range = scheduleGestureRange(
      { kind: 'day', ymd: '2026-10-31' },
      { kind: 'day', ymd: '2026-11-02' },
      ZONE,
    );
    expect(range).toMatchObject({
      kind: 'allDay',
      startYmd: '2026-10-31',
      endYmd: '2026-11-02',
      isAllDay: true,
      startAt: at('2026-10-31T00:00:00+08:00'),
      dueAt: at('2026-11-02T00:00:00+08:00'),
    });
    expect(scheduleRangeHitsCell(range!, { kind: 'day', ymd: '2026-11-02' })).toBe(true);
    expect(scheduleRangeHitsCell(range!, { kind: 'day', ymd: '2026-11-01' })).toBe(true);
    expect(scheduleRangeHitsCell(range!, { kind: 'day', ymd: '2026-10-30' })).toBe(false);
  });

  it('is not a create target when the press starts on an existing item', () => {
    expect(
      scheduleGestureRange(
        { kind: 'item' },
        { kind: 'hour', ymd: '2026-10-30', hour: 9, minute: 0 },
        ZONE,
      ),
    ).toBeNull();
    expect(
      scheduleGestureRange({ kind: 'item' }, { kind: 'day', ymd: '2026-10-30' }, ZONE),
    ).toBeNull();
  });

  it('rejects a minute that is not a quarter hour', () => {
    expect(
      scheduleGestureRange(
        { kind: 'hour', ymd: '2026-10-30', hour: 9, minute: 10 as SlotMinute },
        { kind: 'hour', ymd: '2026-10-30', hour: 9, minute: 10 as SlotMinute },
        ZONE,
      ),
    ).toBeNull();
  });
});
