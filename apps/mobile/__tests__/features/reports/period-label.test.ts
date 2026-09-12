import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  clockTime,
  formatPeriodMeta,
  heatAlphaHex,
  isoWeek,
  mondayFirstCol,
  recentTimeLabel,
  weekdayLabel,
} from '../../../src/features/reports/period-label';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

describe('isoWeek', () => {
  it('computes ISO week numbers', () => {
    expect(isoWeek('2026-09-07')).toBe(37);
    expect(isoWeek('2026-01-01')).toBe(1);
  });
});

describe('addDaysYmd', () => {
  it('adds and subtracts days across month bounds', () => {
    expect(addDaysYmd('2026-09-13', -1)).toBe('2026-09-12');
    expect(addDaysYmd('2026-10-01', -1)).toBe('2026-09-30');
  });
});

describe('formatPeriodMeta', () => {
  const weekday = (ymd: string) => weekdayLabel(ymd, WEEKDAYS);
  it('daily shows date and weekday', () => {
    expect(formatPeriodMeta('daily', '2026-09-12', '2026-09-13', weekday)).toBe('2026-09-12 · 周六');
  });
  it('weekly shows compact range and ISO week', () => {
    expect(formatPeriodMeta('weekly', '2026-09-07', '2026-09-14', weekday)).toBe('09-07 – 09-13 · W37');
  });
  it('monthly and yearly show their grain', () => {
    expect(formatPeriodMeta('monthly', '2026-09-01', '2026-10-01', weekday)).toBe('2026-09');
    expect(formatPeriodMeta('yearly', '2026-01-01', '2027-01-01', weekday)).toBe('2026');
  });
});

describe('heatAlphaHex', () => {
  it('follows the absolute scale 0.18 + 0.62 × min(n,5)/5', () => {
    expect(heatAlphaHex(1)).toBe('4e');
    expect(heatAlphaHex(3)).toBe('8d');
    expect(heatAlphaHex(5)).toBe('cc');
    expect(heatAlphaHex(9)).toBe('cc');
  });
});

describe('mondayFirstCol', () => {
  it('is Monday-first', () => {
    expect(mondayFirstCol('2026-09-07')).toBe(0); // Monday
    expect(mondayFirstCol('2026-09-13')).toBe(6); // Sunday
    expect(mondayFirstCol('2026-09-01')).toBe(1); // Tuesday
  });
});

describe('recentTimeLabel', () => {
  const now = new Date('2026-09-12T20:00:00');
  it('today shows clock time', () => {
    expect(recentTimeLabel('2026-09-12T16:40:00', '昨天', now)).toBe('16:40');
  });
  it('yesterday shows the label', () => {
    expect(recentTimeLabel('2026-09-11T09:00:00', '昨天', now)).toBe('昨天');
  });
  it('earlier shows MM-DD', () => {
    expect(recentTimeLabel('2026-09-03T09:00:00', '昨天', now)).toBe('09-03');
  });
});

describe('clockTime', () => {
  it('zero-pads hours and minutes', () => {
    expect(clockTime('2026-09-12T08:05:00')).toBe('08:05');
  });
});
