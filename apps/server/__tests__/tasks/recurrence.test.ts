import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import {
  allDayDates,
  expandFixedTask,
  expandTask,
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
    pinned: false,
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
        pinned: false,
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
        pinned: false,
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

  it('expands holidays and makeup workdays at the inclusive window bounds', async () => {
    const lookup = (date: string) =>
      Promise.resolve(
        date === '2026-10-01' || date === '2026-10-07'
          ? ('holiday' as const)
          : date === '2026-09-26'
            ? ('workday' as const)
            : null,
      );
    const dueAt = DateTime.fromISO('2026-10-01T09:00:00', { zone: 'Asia/Shanghai' }).toJSDate();
    const holidayTask = {
      id: 't-hol',
      listId: 'l1',
      title: '假日',
      timezone: 'Asia/Shanghai',
      isAllDay: false,
      dueAt,
      startAt: null,
      recurrenceRrule: null,
      recurrenceDtstart: dueAt,
      status: 'todo' as const,
      priority: 3,
      pinned: false,
      recurrenceKind: 'holidays' as const,
    };
    const from = DateTime.fromISO('2026-10-01T00:00:00.000Z').toJSDate();
    const to = DateTime.fromISO('2026-10-07T16:00:00.000Z').toJSDate();
    const holidays = await expandFixedTask(holidayTask, [], from, to, lookup);
    expect(holidays.map((item) => item.occurrenceAt.toISOString())).toEqual([
      '2026-10-01T01:00:00.000Z',
      '2026-10-07T01:00:00.000Z',
    ]);

    const workDue = DateTime.fromISO('2026-09-25T09:00:00', { zone: 'Asia/Shanghai' }).toJSDate();
    const workdays = await expandFixedTask(
      {
        ...holidayTask,
        id: 't-work',
        title: '工作日',
        dueAt: workDue,
        recurrenceDtstart: workDue,
        recurrenceKind: 'legal_workdays',
      },
      [],
      DateTime.fromISO('2026-09-25T00:00:00.000Z').toJSDate(),
      DateTime.fromISO('2026-10-02T16:00:00.000Z').toJSDate(),
      lookup,
    );
    expect(workdays.map((item) => item.occurrenceAt.toISOString())).toEqual([
      '2026-09-25T01:00:00.000Z',
      '2026-09-26T01:00:00.000Z',
      '2026-09-28T01:00:00.000Z',
      '2026-09-29T01:00:00.000Z',
      '2026-09-30T01:00:00.000Z',
      '2026-10-02T01:00:00.000Z',
    ]);
  });

  function atShanghai(iso: string): Date {
    return DateTime.fromISO(iso, { zone: 'Asia/Shanghai' }).toJSDate();
  }

  function shanghaiClock(date: Date): string {
    return DateTime.fromJSDate(date, { zone: 'Asia/Shanghai' }).toFormat('yyyy-MM-dd HH:mm');
  }

  function yearlyTask(anchor: Date, dueAt = anchor) {
    return {
      id: 't-year',
      listId: 'l1',
      title: '生日',
      timezone: 'Asia/Shanghai',
      isAllDay: false,
      dueAt,
      startAt: null,
      recurrenceRrule: null,
      recurrenceDtstart: anchor,
      status: 'todo' as const,
      priority: 3,
      pinned: false,
      recurrenceKind: 'yearly' as const,
    };
  }

  it('keeps a Feb 29 anchor and uses Feb 28 in common years', async () => {
    const anchor = atShanghai('2028-02-29T09:00:00');
    const next = await nextFixedOccurrenceAfter(
      { dueAt: anchor, timezone: 'Asia/Shanghai', isAllDay: false, recurrenceKind: 'yearly', recurrenceDtstart: anchor },
      anchor,
    );
    expect(shanghaiClock(next as Date)).toBe('2029-02-28 09:00');
    const beforeLeap = atShanghai('2031-02-28T09:00:00');
    const leap = await nextFixedOccurrenceAfter(
      {
        dueAt: beforeLeap,
        timezone: 'Asia/Shanghai',
        isAllDay: false,
        recurrenceKind: 'yearly',
        recurrenceDtstart: anchor,
      },
      beforeLeap,
    );
    expect(shanghaiClock(leap as Date)).toBe('2032-02-29 09:00');
  });

  it('uses Feb 28 when the next anniversary is the common century year 2100', async () => {
    const anchor = atShanghai('2096-02-29T09:00:00');
    const after = atShanghai('2099-02-28T09:00:00');
    const next = await nextFixedOccurrenceAfter(
      { dueAt: after, timezone: 'Asia/Shanghai', isAllDay: false, recurrenceKind: 'yearly', recurrenceDtstart: anchor },
      after,
    );
    expect(shanghaiClock(next as Date)).toBe('2100-02-28 09:00');
    const beforeLeap = atShanghai('2103-02-28T09:00:00');
    const leap = await nextFixedOccurrenceAfter(
      {
        dueAt: beforeLeap,
        timezone: 'Asia/Shanghai',
        isAllDay: false,
        recurrenceKind: 'yearly',
        recurrenceDtstart: anchor,
      },
      beforeLeap,
    );
    expect(shanghaiClock(leap as Date)).toBe('2104-02-29 09:00');
  });

  it('steps an ordinary yearly date forward one year', async () => {
    const anchor = atShanghai('2026-03-09T09:00:00');
    const next = await nextFixedOccurrenceAfter(
      { dueAt: anchor, timezone: 'Asia/Shanghai', isAllDay: false, recurrenceKind: 'yearly' },
      anchor,
    );
    expect(shanghaiClock(next as Date)).toBe('2027-03-09 09:00');
  });

  it('shows the clamped day and the later leap day on the calendar', async () => {
    const anchor = atShanghai('2028-02-29T09:00:00');
    const common = await expandFixedTask(
      yearlyTask(anchor),
      [],
      atShanghai('2029-02-01T00:00:00'),
      atShanghai('2029-03-01T00:00:00'),
    );
    expect(common.map((item) => shanghaiClock(item.occurrenceAt))).toEqual(['2029-02-28 09:00']);
    const leap = await expandFixedTask(
      yearlyTask(anchor, atShanghai('2029-02-28T09:00:00')),
      [],
      atShanghai('2032-02-01T00:00:00'),
      atShanghai('2032-03-01T00:00:00'),
    );
    expect(leap.map((item) => shanghaiClock(item.occurrenceAt))).toEqual(['2032-02-29 09:00']);
  });
});

describe('timed blocks', () => {
  const zone = 'Asia/Shanghai';
  const from = DateTime.fromISO('2026-10-26T00:00:00.000Z').toJSDate();
  const to = DateTime.fromISO('2026-11-01T16:00:00.000Z').toJSDate();

  function shot(partial: Partial<RecurrenceTask>): RecurrenceTask {
    return {
      id: 't1',
      listId: 'l1',
      title: '评审',
      timezone: zone,
      isAllDay: false,
      dueAt: null,
      startAt: null,
      recurrenceRrule: null,
      recurrenceDtstart: null,
      status: 'todo',
      priority: 3,
      pinned: false,
      habitId: null,
      calendarEndAt: null,
      ...partial,
    };
  }

  it('keeps one block from startAt to a later dueAt', () => {
    const start = DateTime.fromISO('2026-10-30T09:00:00', { zone }).toJSDate();
    const due = DateTime.fromISO('2026-10-30T11:00:00', { zone }).toJSDate();
    const instances = expandTask(
      shot({ startAt: start, dueAt: due, habitId: 'habit-1' }),
      [],
      from,
      to,
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]?.occurrenceAt.toISOString()).toBe(start.toISOString());
    expect(instances[0]?.endsAt?.toISOString()).toBe(due.toISOString());
    expect(instances[0]?.habitId).toBe('habit-1');
    expect(instances[0]?.calendarKey).toBeNull();
  });

  it('uses calendarEndAt when start and due are the same instant', () => {
    const start = DateTime.fromISO('2026-10-30T14:00:00', { zone }).toJSDate();
    const end = DateTime.fromISO('2026-10-30T15:30:00', { zone }).toJSDate();
    const instances = expandTask(
      shot({ startAt: start, dueAt: start, calendarEndAt: end, calendarKey: 'mac:event-1' }),
      [],
      from,
      to,
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]?.occurrenceAt.toISOString()).toBe(start.toISOString());
    expect(instances[0]?.endsAt?.toISOString()).toBe(end.toISOString());
    expect(instances[0]?.calendarKey).toBe('mac:event-1');
  });

  it('leaves a point occurrence when there is no later end', () => {
    const due = DateTime.fromISO('2026-10-30T18:00:00', { zone }).toJSDate();
    const instances = expandTask(shot({ dueAt: due }), [], from, to);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.occurrenceAt.toISOString()).toBe(due.toISOString());
    expect(instances[0]?.endsAt).toBeNull();
  });

  it('shifts each daily occurrence back by the start-to-due duration', () => {
    const due = DateTime.fromISO('2099-10-30T11:00:00', { zone }).toJSDate();
    const start = DateTime.fromISO('2099-10-30T09:00:00', { zone }).toJSDate();
    const instances = expandTask(
      shot({
        startAt: start,
        dueAt: due,
        recurrenceRrule: 'FREQ=DAILY',
        recurrenceDtstart: due,
      }),
      [],
      DateTime.fromISO('2099-10-29T16:00:00.000Z').toJSDate(),
      DateTime.fromISO('2099-11-01T16:00:00.000Z').toJSDate(),
    );
    const friday = instances.find((item) => item.endsAt?.toISOString() === due.toISOString());
    expect(friday?.occurrenceAt.toISOString()).toBe(start.toISOString());
    const saturdayDue = DateTime.fromISO('2099-10-31T11:00:00', { zone }).toJSDate();
    const saturdayStart = DateTime.fromISO('2099-10-31T09:00:00', { zone }).toJSDate();
    const saturday = instances.find(
      (item) => item.endsAt?.toISOString() === saturdayDue.toISOString(),
    );
    expect(saturday?.occurrenceAt.toISOString()).toBe(saturdayStart.toISOString());
  });

  it('keeps an early-morning daily series on the task calendar day', () => {
    const due = DateTime.fromISO('2099-10-30T01:00:00', { zone }).toJSDate();
    const start = DateTime.fromISO('2099-10-29T23:00:00', { zone }).toJSDate();
    const instances = expandTask(
      shot({
        startAt: start,
        dueAt: due,
        recurrenceRrule: 'FREQ=DAILY',
        recurrenceDtstart: due,
      }),
      [],
      DateTime.fromISO('2099-10-29T16:00:00.000Z').toJSDate(),
      DateTime.fromISO('2099-11-01T16:00:00.000Z').toJSDate(),
    );
    const friday = instances.find((item) => item.endsAt?.toISOString() === due.toISOString());
    expect(friday?.occurrenceAt.toISOString()).toBe(start.toISOString());
  });

  it('keeps a daily clock time across a DST change', () => {
    const la = 'America/Los_Angeles';
    const due = DateTime.fromISO('2099-03-07T09:00:00', { zone: la }).toJSDate();
    const instances = expandTask(
      shot({
        timezone: la,
        dueAt: due,
        recurrenceRrule: 'FREQ=DAILY',
        recurrenceDtstart: due,
      }),
      [],
      DateTime.fromISO('2099-03-07T00:00:00', { zone: la }).toJSDate(),
      DateTime.fromISO('2099-03-10T00:00:00', { zone: la }).toJSDate(),
    );
    expect(
      instances.map((item) =>
        DateTime.fromJSDate(item.occurrenceAt, { zone: la }).toFormat('yyyy-MM-dd HH:mm'),
      ),
    ).toEqual(['2099-03-07 09:00', '2099-03-08 09:00', '2099-03-09 09:00']);
    expect(instances.map((item) => item.occurrenceAt.toISOString())).toEqual([
      '2099-03-07T17:00:00.000Z',
      '2099-03-08T16:00:00.000Z',
      '2099-03-09T16:00:00.000Z',
    ]);
  });
});
