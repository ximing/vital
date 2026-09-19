import { describe, expect, it } from 'vitest';
import {
  decadeStart,
  shiftCalendarCursor,
  yearPanelYears,
} from '../../src/lib/calendar-grid';

describe('shiftCalendarCursor', () => {
  it('moves a month, year, decade, or century depending on the panel', () => {
    expect(shiftCalendarCursor('2026-09-01', 'date', 'inner', -1)).toBe('2026-08-01');
    expect(shiftCalendarCursor('2026-09-01', 'date', 'super', -1)).toBe('2025-09-01');
    expect(shiftCalendarCursor('2026-09-01', 'month', 'inner', -1)).toBe('2025-09-01');
    expect(shiftCalendarCursor('2026-09-01', 'month', 'super', -1)).toBe('2016-09-01');
    expect(shiftCalendarCursor('2026-09-01', 'year', 'inner', -1)).toBe('2016-09-01');
    expect(shiftCalendarCursor('2026-09-01', 'year', 'super', -1)).toBe('1926-09-01');
  });
});

describe('yearPanelYears', () => {
  it('shows the decade plus one year on each side', () => {
    expect(decadeStart(2026)).toBe(2020);
    expect(yearPanelYears(2026)).toEqual([
      2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030,
    ]);
  });
});
