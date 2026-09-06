import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { currentPeriod, previousPeriodStart } from '../../src/reports/period.js';

const tz = 'Asia/Shanghai';

describe('currentPeriod', () => {
  it('daily uses the user-tz calendar date', () => {
    const beforeMidnight = DateTime.fromISO('2026-09-06T15:30:00Z');
    const afterMidnight = DateTime.fromISO('2026-09-06T16:00:00Z');
    expect(currentPeriod('daily', tz, 1, beforeMidnight)).toMatchObject({
      start: '2026-09-06',
      end: '2026-09-07',
      label: '2026年9月6日',
    });
    expect(currentPeriod('daily', tz, 1, afterMidnight).start).toBe('2026-09-07');
  });

  it('weekly respects weekStartsOn', () => {
    const monday = DateTime.fromISO('2026-01-05T08:00:00', { zone: tz });
    expect(monday.weekday).toBe(1);
    expect(currentPeriod('weekly', tz, 1, monday)).toMatchObject({
      start: '2026-01-05',
      end: '2026-01-12',
    });
    const sunday = DateTime.fromISO('2026-01-04T08:00:00', { zone: tz });
    expect(currentPeriod('weekly', tz, 1, sunday).start).toBe('2025-12-29');
    expect(currentPeriod('weekly', tz, 0, sunday).start).toBe('2026-01-04');
  });

  it('monthly and yearly are exclusive-end', () => {
    const d = DateTime.fromISO('2026-09-06T01:00:00Z');
    expect(currentPeriod('monthly', tz, 1, d)).toMatchObject({
      start: '2026-09-01',
      end: '2026-10-01',
      label: '2026年9月',
    });
    expect(currentPeriod('yearly', tz, 1, d)).toMatchObject({
      start: '2026-01-01',
      end: '2027-01-01',
      label: '2026年',
    });
  });
});

describe('previousPeriodStart', () => {
  it('walks back one period', () => {
    expect(previousPeriodStart('daily', '2026-09-06', tz)).toBe('2026-09-05');
    expect(previousPeriodStart('weekly', '2026-01-05', tz)).toBe('2025-12-29');
    expect(previousPeriodStart('monthly', '2026-03-01', tz)).toBe('2026-02-01');
    expect(previousPeriodStart('yearly', '2026-01-01', tz)).toBe('2025-01-01');
  });
});
