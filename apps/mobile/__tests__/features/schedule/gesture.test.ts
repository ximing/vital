import { describe, expect, it } from 'vitest';
import {
  resizeTimedDraft,
  resizeTimedOccurrence,
  scheduleGestureRange,
  shiftAllDayOccurrence,
  shiftChipByDay,
  shiftTimedByDays,
  shiftTimedDraft,
  shiftTimedOccurrence,
  type HourCell,
} from '../../../src/features/schedule/gesture';
import { bandDayAt, hourCellAt, monthDayAt, QUARTER_H } from '../../../src/features/schedule/grid';
import { zonedLocalMidnightIso, zonedWallTimeIso } from '../../../src/features/schedule/time';

const ZONE = 'Asia/Shanghai';

function hour(ymd: string, hourOfDay: number, minute: 0 | 15 | 30 | 45): HourCell {
  return { kind: 'hour', ymd, hour: hourOfDay, minute };
}

describe('mobile schedule gestures', () => {
  it('keeps a timed create inside the column where the press started', () => {
    const range = scheduleGestureRange(
      hour('2026-10-29', 13, 0),
      hour('2026-10-30', 16, 30),
      ZONE,
    );
    expect(range?.kind).toBe('timed');
    if (range?.kind !== 'timed') return;
    expect(range.ymd).toBe('2026-10-29');
    expect(range.startAt).toBe(zonedWallTimeIso('2026-10-29', '13:00:00', ZONE));
    expect(range.dueAt).toBe(zonedWallTimeIso('2026-10-29', '16:45:00', ZONE));
  });

  it('moves a timed block by the quarters crossed and keeps an off-quarter offset', () => {
    const startAt = zonedWallTimeIso('2026-10-26', '14:07:00', ZONE);
    const dueAt = zonedWallTimeIso('2026-10-26', '15:07:00', ZONE);
    const change = shiftTimedOccurrence({
      startAt,
      dueAt,
      origin: hour('2026-10-26', 14, 0),
      target: hour('2026-10-30', 16, 30),
    });
    expect(change).toEqual({
      startAt: zonedWallTimeIso('2026-10-30', '16:37:00', ZONE),
      dueAt: zonedWallTimeIso('2026-10-30', '17:37:00', ZONE),
      isAllDay: false,
    });
    expect(
      shiftTimedOccurrence({
        startAt,
        dueAt,
        origin: hour('2026-10-26', 14, 0),
        target: hour('2026-10-26', 14, 0),
      }),
    ).toBeNull();
  });

  it('moves a month chip by whole days and an all-day span by its inclusive dates', () => {
    const timed = shiftTimedByDays({
      startAt: zonedWallTimeIso('2026-10-30', '09:00:00', ZONE),
      dueAt: zonedWallTimeIso('2026-10-30', '10:00:00', ZONE),
      originYmd: '2026-10-30',
      targetYmd: '2026-11-02',
    });
    expect(timed?.startAt).toBe(zonedWallTimeIso('2026-11-02', '09:00:00', ZONE));
    expect(timed?.isAllDay).toBe(false);

    const allDay = shiftAllDayOccurrence({
      startYmd: '2026-10-30',
      endYmd: '2026-10-31',
      originYmd: '2026-10-30',
      targetYmd: '2026-11-01',
      timeZone: ZONE,
    });
    expect(allDay).toEqual({
      startAt: zonedLocalMidnightIso('2026-11-01', ZONE),
      dueAt: zonedLocalMidnightIso('2026-11-02', ZONE),
      isAllDay: true,
    });
    expect(
      shiftChipByDay({
        startAt: zonedWallTimeIso('2026-10-30', '09:00:00', ZONE),
        dueAt: zonedWallTimeIso('2026-10-30', '09:00:00', ZONE),
        isAllDay: false,
        spanStartYmd: '2026-10-30',
        spanEndYmd: '2026-10-30',
        originYmd: '2026-10-30',
        targetYmd: '2026-10-30',
        timeZone: ZONE,
      }),
    ).toBeNull();
  });

  it('resizes the touched edge, stays on that day, and keeps at least 15 minutes', () => {
    const startAt = zonedWallTimeIso('2026-10-30', '16:30:00', ZONE);
    const dueAt = zonedWallTimeIso('2026-10-30', '17:45:00', ZONE);
    expect(
      resizeTimedOccurrence({
        ymd: '2026-10-30',
        startAt,
        dueAt,
        edge: 'end',
        hour: 17,
        minute: 45,
        timeZone: ZONE,
      }),
    ).toEqual({
      startAt,
      dueAt: zonedWallTimeIso('2026-10-30', '18:00:00', ZONE),
      isAllDay: false,
    });
    expect(
      resizeTimedOccurrence({
        ymd: '2026-10-30',
        startAt,
        dueAt,
        edge: 'start',
        hour: 17,
        minute: 0,
        timeZone: ZONE,
      })?.startAt,
    ).toBe(zonedWallTimeIso('2026-10-30', '17:00:00', ZONE));
    expect(
      resizeTimedOccurrence({
        ymd: '2026-10-30',
        startAt,
        dueAt,
        edge: 'end',
        hour: 23,
        minute: 45,
        timeZone: ZONE,
      })?.dueAt,
    ).toBe(zonedLocalMidnightIso('2026-10-31', ZONE));
    expect(
      resizeTimedOccurrence({
        ymd: '2026-10-30',
        startAt,
        dueAt,
        edge: 'end',
        hour: 17,
        minute: 30,
        timeZone: ZONE,
      }),
    ).toBeNull();
  });

  it('slides and stretches a draft without leaving its day', () => {
    const created = scheduleGestureRange(hour('2026-10-30', 15, 0), hour('2026-10-30', 15, 0), ZONE);
    if (created?.kind !== 'timed') throw new Error('expected a timed draft');
    const moved = shiftTimedDraft(created, hour('2026-10-30', 15, 0), hour('2026-10-31', 16, 15), ZONE);
    expect(moved?.ymd).toBe('2026-10-30');
    expect(moved?.startAt).toBe(zonedWallTimeIso('2026-10-30', '16:15:00', ZONE));
    expect(moved?.dueAt).toBe(zonedWallTimeIso('2026-10-30', '16:30:00', ZONE));
    const stretched = resizeTimedDraft(created, 'end', 16, 0, ZONE);
    expect(stretched?.dueAt).toBe(zonedWallTimeIso('2026-10-30', '16:15:00', ZONE));
    expect(stretched?.ymd).toBe('2026-10-30');
  });
});

describe('mobile schedule hit testing', () => {
  const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];
  const viewport = { pageX: 0, pageY: 100, width: 48 + 70 * 7, height: 400 };

  it('maps a finger to a quarter and ignores the hour gutter', () => {
    expect(hourCellAt(viewport, 0, days, 10, 100)).toBeNull();
    const cell = hourCellAt(viewport, 0, days, 48 + 70 * 4 + 4, 100 + 9 * 4 * QUARTER_H + 2);
    expect(cell).toEqual(hour('2026-10-30', 9, 0));
    const later = hourCellAt(viewport, 9 * 4 * QUARTER_H, days, 48 + 4, 100 + 2);
    expect(later).toEqual(hour('2026-10-26', 9, 0));
  });

  it('maps the all-day band and the month grid by column', () => {
    expect(
      bandDayAt({ pageX: 0, pageY: 0, width: viewport.width, height: 40, days }, 48 + 70 * 4 + 1, 8),
    ).toBe('2026-10-30');
    const ymds = Array.from({ length: 42 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`);
    expect(monthDayAt({ pageX: 0, pageY: 0, width: 70, height: 60, ymds }, 69, 59)).toBe(ymds[41]);
    expect(monthDayAt({ pageX: 0, pageY: 0, width: 70, height: 60, ymds }, 0, 0)).toBe(ymds[0]);
  });
});
