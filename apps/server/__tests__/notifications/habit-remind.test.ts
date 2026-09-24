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

function input(over: Partial<CountHabitRemindInput> & Pick<CountHabitRemindInput, 'now'>): CountHabitRemindInput {
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
  it('splits a window into even slots and skips a missed one past the grace', () => {
    const first = nextCountHabitReminder(input({ now: at('2026-09-16T08:00:00') }));
    expect(hm(first)).toBe('08:00');
    expect(first?.done).toBe(0);

    const afterMiss = nextCountHabitReminder(input({ now: at('2026-09-16T08:30:00') }));
    expect(hm(afterMiss)).toBe('09:45');
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

  it('waits out the floor when the planned slot is already past', () => {
    const ring = nextCountHabitReminder(
      input({
        now: at('2026-09-16T10:00:00'),
        seq: 2,
        lastCompletedAt: at('2026-09-16T10:00:00'),
      }),
    );
    expect(hm(ring)).toBe('10:20');
    expect(ring?.occurrenceAt.toISOString()).toBe(at('2026-09-16T10:20:00').toISOString());
  });

  it('continues along later slots while the open instance stays undone', () => {
    const ring = nextCountHabitReminder(input({ now: at('2026-09-16T10:01:00') }));
    expect(hm(ring)).toBe('11:30');
  });

  it('uses the shorter slice as the floor inside a tight window', () => {
    const ring = nextCountHabitReminder(
      input({
        now: at('2026-09-16T12:01:00'),
        seq: 2,
        targetCount: 4,
        windowStart: '12:00',
        windowEnd: '13:00',
        lastCompletedAt: at('2026-09-16T12:01:00'),
      }),
    );
    expect(hm(ring)).toBe('12:16');
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
        now: at('2026-09-16T13:20:00'),
        quietHoursStart: '12:00',
        quietHoursEnd: '14:00',
      }),
    );
    expect(hm(held)).toBe('14:00');
    if (!held) throw new Error('missing held ring');
    expect(DateTime.fromJSDate(held.occurrenceAt, { zone: TZ }).toFormat('HH:mm')).toBe('13:15');

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
