import { describe, expect, it } from 'vitest';
import {
  calendarSyncPayloadReady,
  deviceCalendarSyncSchema,
  deviceCalendarWindow,
  planDeviceCalendarSync,
  type CalendarSyncTask,
  type DeviceCalendarSyncInput,
} from '../src/calendar-sync.js';

const NOW = new Date('2026-10-13T04:00:00.000Z');
const SPAN = deviceCalendarWindow('Asia/Shanghai', NOW);
const START = '2026-10-13T01:30:00.000Z';
const MOVED = '2026-10-13T06:00:00.000Z';

function input(events: DeviceCalendarSyncInput['events'], source: DeviceCalendarSyncInput['source'] = 'mac'): DeviceCalendarSyncInput {
  return { source, windowStart: SPAN.windowStart, windowEnd: SPAN.windowEnd, events };
}

function task(overrides: Partial<CalendarSyncTask> = {}): CalendarSyncTask {
  return {
    id: 'task-1',
    calendarKey: 'mac:week',
    title: '周会',
    startAt: START,
    dueAt: START,
    isAllDay: false,
    status: 'todo',
    deletedAt: null,
    ...overrides,
  };
}

describe('device calendar sync plan', () => {
  it('adds an event, then updates the same task when the clock or title changes', () => {
    const created = planDeviceCalendarSync(input([{ key: 'mac:week', title: '周会', start: START, allDay: false }]), []);
    expect(created.create.map((event) => event.key)).toEqual(['mac:week']);
    expect(created.update).toEqual([]);
    expect(created.remove).toEqual([]);

    const moved = planDeviceCalendarSync(
      input([{ key: 'mac:week', title: ' 改期 ', start: MOVED, allDay: false }]),
      [task()],
    );
    expect(moved.create).toEqual([]);
    expect(moved.remove).toEqual([]);
    expect(moved.update).toEqual([{ id: 'task-1', event: { key: 'mac:week', title: '改期', start: MOVED, allDay: false } }]);
  });

  it('removes an open task whose event left the window and leaves done, deleted, and other devices', () => {
    const plan = planDeviceCalendarSync(input([]), [
      task(),
      task({ id: 'done', status: 'done' }),
      task({ id: 'dismissed', deletedAt: '2026-10-01T00:00:00.000Z' }),
      task({ id: 'phone', calendarKey: 'ios:same-day' }),
      task({ id: 'later', startAt: '2026-10-21T01:00:00.000Z', dueAt: '2026-10-21T01:00:00.000Z' }),
    ]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual(['task-1']);
  });

  it('does not recreate a task the user already deleted', () => {
    const plan = planDeviceCalendarSync(input([{ key: 'mac:week', title: '周会', start: START, allDay: false }]), [
      task({ deletedAt: '2026-10-12T00:00:00.000Z' }),
    ]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('skips a second device when a live task already has the same title and start', () => {
    const plan = planDeviceCalendarSync(
      input([{ key: 'ios:icloud', title: '周会', start: START, allDay: false }], 'ios'),
      [task()],
    );
    expect(plan.create).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('ignores an event that starts outside the window', () => {
    const plan = planDeviceCalendarSync(
      input([{ key: 'mac:old', title: '上周', start: '2026-10-01T01:00:00.000Z', allDay: false }]),
      [],
    );
    expect(plan.create).toEqual([]);
  });

  it('accepts an offset instant and rejects a foreign key or a long window', () => {
    const parsed = deviceCalendarSyncSchema.safeParse({
      source: 'mac',
      windowStart: '2026-10-13T00:00:00+08:00',
      windowEnd: '2026-10-21T00:00:00+08:00',
      events: [{ key: 'mac:abc', title: '周会', start: '2026-10-13T09:30:00+08:00', allDay: false }],
    });
    expect(parsed.success).toBe(true);

    expect(
      deviceCalendarSyncSchema.safeParse({
        source: 'mac',
        windowStart: SPAN.windowStart,
        windowEnd: SPAN.windowEnd,
        events: [{ key: 'ios:abc', title: '周会', start: START, allDay: false }],
      }).success,
    ).toBe(false);

    expect(
      deviceCalendarSyncSchema.safeParse({
        source: 'mac',
        windowStart: '2026-10-01T00:00:00.000Z',
        windowEnd: '2026-10-20T00:00:00.000Z',
        events: [],
      }).success,
    ).toBe(false);
  });

  it('treats an empty read as a delete only when the host sends keys', () => {
    expect(calendarSyncPayloadReady([], 'mac', false)).toBe(false);
    expect(calendarSyncPayloadReady([], 'mac', true)).toBe(true);
    expect(calendarSyncPayloadReady([{ key: 'mac:week' }], 'mac', true)).toBe(true);
    expect(calendarSyncPayloadReady([{ key: undefined }], 'mac', true)).toBe(false);
  });

  it('covers local today through eight midnights, and a point event still lands on that day', () => {
    expect(SPAN).toEqual({
      windowStart: '2026-10-12T16:00:00.000Z',
      windowEnd: '2026-10-20T16:00:00.000Z',
    });
  });
});
