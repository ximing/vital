import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  allDayDates,
  expandFixedTask,
  matchesAllDay,
  nextFixedOccurrenceAfter,
  nextAllDayAfter,
  parseRrule,
  type RecurrenceTask,
} from '../../src/tasks/recurrence.js';

function task(partial: Partial<RecurrenceTask> & { recurrenceRrule: string; recurrenceDtstart: Date }): RecurrenceTask {
  return {
    id: 't1',
    listId: 'l1',
    title: 'x',
    timezone: 'Asia/Shanghai',
    isAllDay: true,
    dueAt: partial.recurrenceDtstart,
    startAt: null,
    status: 'todo',
    priority: 3,
    ...partial,
  };
}

describe('all-day calendar-day walk', () => {
  it('weekly BYDAY=MO,WE,FR dtstart Monday: after Wednesday is Friday', () => {
    const monday = DateTime.fromObject(
      { year: 2026, month: 3, day: 9 },
      { zone: 'Asia/Shanghai' },
    ).startOf('day');
    const wednesday = monday.plus({ days: 2 });
    const t = task({
      recurrenceRrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      recurrenceDtstart: monday.toJSDate(),
      dueAt: wednesday.toJSDate(),
    });
    const next = nextAllDayAfter(t, wednesday.toJSDate());
    expect(next).not.toBeNull();
    const nextLocal = DateTime.fromJSDate(next as Date, { zone: 'Asia/Shanghai' });
    expect(nextLocal.toISODate()).toBe('2026-03-13');
  });

  it('COUNT=3 on MO,WE,FR emits three weekdays not three weeks', () => {
    const monday = DateTime.fromObject(
      { year: 2026, month: 3, day: 9 },
      { zone: 'Asia/Shanghai' },
    ).startOf('day');
    const t = task({
      recurrenceRrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=3',
      recurrenceDtstart: monday.toJSDate(),
    });
    const from = monday.minus({ days: 1 }).toUTC().toJSDate();
    const to = monday.plus({ days: 20 }).toUTC().toJSDate();
    const dates = allDayDates(t, from, to).map((d) => d.toISODate());
    expect(dates).toEqual(['2026-03-09', '2026-03-11', '2026-03-13']);
  });

  it('UNTIL stops the walk', () => {
    const monday = DateTime.fromObject(
      { year: 2026, month: 3, day: 9 },
      { zone: 'Asia/Shanghai' },
    ).startOf('day');
    const t = task({
      recurrenceRrule: 'FREQ=DAILY;UNTIL=20260311',
      recurrenceDtstart: monday.toJSDate(),
    });
    const dates = allDayDates(
      t,
      monday.toUTC().toJSDate(),
      monday.plus({ days: 10 }).toUTC().toJSDate(),
    ).map((d) => d.toISODate());
    expect(dates).toEqual(['2026-03-09', '2026-03-10', '2026-03-11']);
  });

  it('America/Los_Angeles DST spring-forward stays local midnight', () => {
    const start = DateTime.fromObject(
      { year: 2026, month: 3, day: 7 },
      { zone: 'America/Los_Angeles' },
    ).startOf('day');
    const t = task({
      timezone: 'America/Los_Angeles',
      recurrenceRrule: 'FREQ=DAILY',
      recurrenceDtstart: start.toJSDate(),
    });
    const dates = allDayDates(
      t,
      start.toUTC().toJSDate(),
      start.plus({ days: 3 }).endOf('day').toUTC().toJSDate(),
    );
    for (const d of dates) {
      expect(d.hour).toBe(0);
      expect(d.minute).toBe(0);
      expect(d.zoneName).toBe('America/Los_Angeles');
    }
    expect(dates.map((d) => d.toISODate())).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('400-cap does not fire for a 2-year-old daily on a 7-day window', () => {
    const start = DateTime.fromObject(
      { year: 2024, month: 3, day: 9 },
      { zone: 'Asia/Shanghai' },
    ).startOf('day');
    const t = task({
      recurrenceRrule: 'FREQ=DAILY',
      recurrenceDtstart: start.toJSDate(),
    });
    const from = DateTime.fromObject(
      { year: 2026, month: 3, day: 9 },
      { zone: 'Asia/Shanghai' },
    ).startOf('day');
    const dates = allDayDates(t, from.toUTC().toJSDate(), from.plus({ days: 6 }).toUTC().toJSDate());
    expect(dates).toHaveLength(7);
  });

  it('daily matchesAllDay interval', () => {
    const opts = parseRrule('FREQ=DAILY;INTERVAL=2');
    const dtstart = DateTime.fromISO('2026-03-09', { zone: 'Asia/Shanghai' }).startOf('day');
    expect(matchesAllDay(dtstart, dtstart, opts, 2)).toBe(true);
    expect(matchesAllDay(dtstart.plus({ days: 1 }), dtstart, opts, 2)).toBe(false);
    expect(matchesAllDay(dtstart.plus({ days: 2 }), dtstart, opts, 2)).toBe(true);
  });
});

describe('fixed recurrence kinds', () => {
  it('finds the next legal workday while respecting a make-up Saturday', async () => {
    const dueAt = DateTime.fromISO('2026-02-20T09:00:00', { zone: 'Asia/Shanghai' }).toJSDate();
    const next = await nextFixedOccurrenceAfter(
      { dueAt, timezone: 'Asia/Shanghai', isAllDay: false, recurrenceKind: 'legal_workdays' },
      dueAt,
      (date) => Promise.resolve(date === '2026-02-21' ? ('workday' as const) : null),
    );
    expect(DateTime.fromJSDate(next as Date, { zone: 'Asia/Shanghai' }).toISO()).toContain('2026-02-21T09:00:00');
  });

  it('expands a timed daily series across a calendar window', async () => {
    const dueAt = DateTime.fromISO('2026-09-07T09:00:00', { zone: 'Asia/Shanghai' }).toJSDate();
    const instances = await expandFixedTask(
      {
        id: 't1',
        listId: 'l1',
        title: '晨间规划',
        timezone: 'Asia/Shanghai',
        isAllDay: false,
        dueAt,
        startAt: null,
        recurrenceRrule: null,
        recurrenceDtstart: dueAt,
        status: 'todo',
        priority: 3,
        recurrenceKind: 'daily',
      },
      [],
      DateTime.fromISO('2026-09-07T00:00:00.000Z').toJSDate(),
      DateTime.fromISO('2026-09-09T23:59:59.000Z').toJSDate(),
    );
    expect(instances.map((item) => item.occurrenceAt.toISOString())).toEqual([
      '2026-09-07T01:00:00.000Z',
      '2026-09-08T01:00:00.000Z',
      '2026-09-09T01:00:00.000Z',
    ]);
  });

  it('skips ahead for a stale daily without duplicating completions', async () => {
    const dueAt = DateTime.fromISO('2024-09-01T09:00:00', { zone: 'Asia/Shanghai' }).toJSDate();
    const done = DateTime.fromISO('2026-09-07T09:00:00', { zone: 'Asia/Shanghai' }).toJSDate();
    const instances = await expandFixedTask(
      {
        id: 't1',
        listId: 'l1',
        title: '晨间规划',
        timezone: 'Asia/Shanghai',
        isAllDay: false,
        dueAt,
        startAt: null,
        recurrenceRrule: null,
        recurrenceDtstart: dueAt,
        status: 'todo',
        priority: 3,
        recurrenceKind: 'daily',
      },
      [{ occurrenceAt: done }],
      DateTime.fromISO('2026-09-07T00:00:00.000Z').toJSDate(),
      DateTime.fromISO('2026-09-09T23:59:59.000Z').toJSDate(),
    );
    expect(instances.map((item) => [item.occurrenceAt.toISOString(), item.status])).toEqual([
      ['2026-09-07T01:00:00.000Z', 'done'],
      ['2026-09-08T01:00:00.000Z', 'todo'],
      ['2026-09-09T01:00:00.000Z', 'todo'],
    ]);
  });
});
