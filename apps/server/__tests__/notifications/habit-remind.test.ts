import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { renderMeowMessage } from '../../src/notifications/dispatch.js';
import {
  nextCountHabitReminder,
  type CountHabitRemindInput,
} from '../../src/notifications/habit-remind.js';

const TZ = 'Asia/Shanghai';

function at(local: string): Date {
  return DateTime.fromISO(local, { zone: TZ }).toJSDate();
}

function input(
  over: Partial<CountHabitRemindInput> & Pick<CountHabitRemindInput, 'now'>,
): CountHabitRemindInput {
  return {
    targetCount: 8,
    seq: 1,
    windowStart: '08:00',
    windowEnd: '22:00',
    timezone: TZ,
    allDayNotifyTime: '09:00',
    lastCompletedAt: null,
    remindedToday: false,
    existingReminderAt: null,
    quietHoursStart: null,
    quietHoursEnd: null,
    ...over,
  };
}

function hm(ring: { scheduledAt: Date } | null): string | null {
  if (!ring) return null;
  return DateTime.fromJSDate(ring.scheduledAt, { zone: TZ }).toFormat('HH:mm');
}

describe('nextCountHabitReminder', () => {
  it('keeps an on-pace cup on its slot and nudges once if that ring is missed', () => {
    const first = nextCountHabitReminder(input({ now: at('2026-09-16T08:00:00') }));
    expect(hm(first)).toBe('08:00');
    expect(first?.done).toBe(0);

    const followUp = nextCountHabitReminder(input({ now: at('2026-09-16T08:30:00') }));
    expect(hm(followUp)).toBe('08:45');

    const skipped = nextCountHabitReminder(input({ now: at('2026-09-16T09:01:00') }));
    expect(hm(skipped)).toBe('11:30');
  });

  it('keeps the planned slot when the previous count was on pace', () => {
    const ring = nextCountHabitReminder(
      input({
        now: at('2026-09-16T08:10:00'),
        seq: 2,
        lastCompletedAt: at('2026-09-16T08:10:00'),
      }),
    );
    expect(hm(ring)).toBe('09:45');
    expect(ring?.done).toBe(1);
  });

  it('reflows the remaining cups across the rest of the window when a cup is finished late', () => {
    const ring = nextCountHabitReminder(
      input({
        now: at('2026-09-16T10:00:00'),
        seq: 2,
        lastCompletedAt: at('2026-09-16T10:00:00'),
      }),
    );
    expect(hm(ring)).toBe('11:42');
    if (!ring) throw new Error('missing reflow ring');
    const gap = ring.scheduledAt.getTime() - at('2026-09-16T10:00:00').getTime();
    expect(gap).toBeGreaterThan(75 * 60 * 1000);
    expect(gap).toBeLessThan(105 * 60 * 1000);
  });

  it('asks again two slices later after the follow-up is also missed', () => {
    const ring = nextCountHabitReminder(input({ now: at('2026-09-16T10:01:00') }));
    expect(hm(ring)).toBe('11:30');
  });

  it('spreads a late 8-cup day from 06:00 to 23:30 instead of ringing every 20 minutes', () => {
    const afterFirst = nextCountHabitReminder(
      input({
        now: at('2026-09-16T10:22:39'),
        seq: 2,
        windowStart: '06:00',
        windowEnd: '23:30',
        lastCompletedAt: at('2026-09-16T10:22:39'),
      }),
    );
    expect(hm(afterFirst)).toBe('12:15');

    const afterSecond = nextCountHabitReminder(
      input({
        now: at('2026-09-16T12:34:04'),
        seq: 3,
        windowStart: '06:00',
        windowEnd: '23:30',
        lastCompletedAt: at('2026-09-16T12:34:04'),
      }),
    );
    expect(hm(afterSecond)).toBe('14:23');

    const backOnPace = nextCountHabitReminder(
      input({
        now: at('2026-09-16T13:22:00'),
        seq: 5,
        windowStart: '06:00',
        windowEnd: '23:30',
        lastCompletedAt: at('2026-09-16T13:21:51'),
      }),
    );
    expect(hm(backOnPace)).toBe('14:45');
  });

  it('stays on the slot inside a tight window and drops a cup that cannot fit the minimum gap', () => {
    const onPace = nextCountHabitReminder(
      input({
        now: at('2026-09-16T12:01:00'),
        seq: 2,
        targetCount: 4,
        windowStart: '12:00',
        windowEnd: '13:00',
        lastCompletedAt: at('2026-09-16T12:01:00'),
      }),
    );
    expect(hm(onPace)).toBe('12:15');

    expect(
      nextCountHabitReminder(
        input({
          now: at('2026-09-16T12:20:00'),
          seq: 2,
          targetCount: 4,
          windowStart: '12:00',
          windowEnd: '13:00',
          lastCompletedAt: at('2026-09-16T12:20:00'),
        }),
      ),
    ).toBeNull();
  });

  it('does not schedule catch-up inside the last 90 minutes', () => {
    expect(
      nextCountHabitReminder(
        input({
          now: at('2026-09-16T20:00:00'),
          seq: 2,
          lastCompletedAt: at('2026-09-16T20:00:00'),
        }),
      ),
    ).toBeNull();

    const stillFits = nextCountHabitReminder(
      input({
        now: at('2026-09-16T18:00:00'),
        seq: 2,
        lastCompletedAt: at('2026-09-16T18:00:00'),
      }),
    );
    expect(hm(stillFits)).toBe('19:15');
  });

  it('goes quiet once every slot is past the window', () => {
    expect(nextCountHabitReminder(input({ now: at('2026-09-16T21:30:00') }))).toBeNull();
  });

  it('fills a missing window bound from the all-day clock or 21:00', () => {
    const onlyEnd = nextCountHabitReminder(
      input({ now: at('2026-09-16T08:00:00'), windowStart: null, targetCount: 2 }),
    );
    expect(hm(onlyEnd)).toBe('09:00');

    const onlyStart = nextCountHabitReminder(
      input({
        now: at('2026-09-16T08:00:00'),
        windowEnd: null,
        targetCount: 2,
      }),
    );
    expect(hm(onlyStart)).toBe('08:00');
  });

  it('moves a slot out of quiet hours without leaving today or the window', () => {
    const held = nextCountHabitReminder(
      input({
        now: at('2026-09-16T11:50:00'),
        quietHoursStart: '12:00',
        quietHoursEnd: '14:00',
      }),
    );
    expect(hm(held)).toBe('14:00');
    if (!held) throw new Error('missing held ring');
    expect(DateTime.fromJSDate(held.occurrenceAt, { zone: TZ }).toFormat('HH:mm')).toBe('12:15');

    const dropped = nextCountHabitReminder(
      input({
        now: at('2026-09-16T21:10:00'),
        targetCount: 2,
        windowStart: '20:00',
        quietHoursStart: '21:00',
        quietHoursEnd: '08:00',
      }),
    );
    expect(dropped).toBeNull();
  });

  it('pings a windowless habit once at the all-day clock', () => {
    const morning = nextCountHabitReminder(
      input({
        now: at('2026-09-16T08:00:00'),
        seq: 2,
        windowStart: null,
        windowEnd: null,
      }),
    );
    expect(hm(morning)).toBe('09:00');

    const catchUp = nextCountHabitReminder(
      input({
        now: at('2026-09-16T16:00:00'),
        windowStart: null,
        windowEnd: null,
      }),
    );
    if (!catchUp) throw new Error('missing catch-up ring');
    expect(catchUp.scheduledAt.toISOString()).toBe(at('2026-09-16T16:00:00').toISOString());
    expect(hm({ scheduledAt: catchUp.occurrenceAt })).toBe('09:00');

    const again = nextCountHabitReminder(
      input({
        now: at('2026-09-16T16:10:00'),
        windowStart: null,
        windowEnd: null,
        existingReminderAt: at('2026-09-16T16:00:00'),
      }),
    );
    expect(again?.scheduledAt.toISOString()).toBe(at('2026-09-16T16:00:00').toISOString());

    expect(
      nextCountHabitReminder(
        input({
          now: at('2026-09-16T16:00:00'),
          seq: 2,
          windowStart: null,
          windowEnd: null,
        }),
      ),
    ).toBeNull();
    expect(
      nextCountHabitReminder(
        input({
          now: at('2026-09-16T08:30:00'),
          windowStart: null,
          windowEnd: null,
          remindedToday: true,
        }),
      ),
    ).toBeNull();
  });
});

describe('renderMeowMessage habit remind', () => {
  it('uses the habit name and the progress sentence', () => {
    expect(
      renderMeowMessage({
        title: '喝水',
        listId: '',
        listName: '',
        dueAt: null,
        remindAt: '2026-09-16T01:45:00.000Z',
        isAllDay: true,
        timezone: TZ,
        eventType: 'task.remind',
        message: '今天 1/8',
      }),
    ).toEqual({ title: '喝水', msg: '今天 1/8' });
  });
});
