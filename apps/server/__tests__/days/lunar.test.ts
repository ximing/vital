import { describe, expect, it } from 'vitest';
import { catalogByKey } from '../../src/days/catalog.js';
import { computeOccurrence } from '../../src/days/compute.js';
import { jieqiYmd, leapMonthOf, lunarToSolar, nextLunarYearly } from '../../src/days/lunar.js';

describe('lunar calendar', () => {
  it('converts 2026 中秋 and 2027 春节', () => {
    expect(lunarToSolar(2026, 8, 15, false)).toBe('2026-09-25');
    expect(lunarToSolar(2027, 1, 1, false)).toBe('2027-02-06');
    expect(jieqiYmd(2026, '清明', 4, 3, 6)).toBe('2026-04-05');
    expect(leapMonthOf(2023)).toBe(2);
    expect(leapMonthOf(2026)).toBeNull();
  });

  it('finds next lunar yearly date after mid-September 2026', () => {
    expect(nextLunarYearly(8, 15, false, '2026-09-16')).toBe('2026-09-25');
    expect(nextLunarYearly(8, 15, false, '2026-09-26')).toBe('2027-09-15');
  });
});

describe('catalog + headline', () => {
  it('counts down to 2026 mid-autumn', () => {
    const def = catalogByKey('cn.mid-autumn');
    expect(def?.occurrenceInYear(2026)).toBe('2026-09-25');
    const occ = computeOccurrence(
      {
        calendar: 'lunar',
        repeat: 'yearly',
        displayMode: 'auto',
        anchorYmd: '2026-09-25',
        lunarMonth: 8,
        lunarDay: 15,
        lunarLeap: false,
        catalogKey: 'cn.mid-autumn',
      },
      '2026-09-16',
    );
    expect(occ.nextYmd).toBe('2026-09-25');
    expect(occ.headline).toMatchObject({ kind: 'countdown', days: 9 });
  });

  it('marks today and then switches to next year', () => {
    const input = {
      calendar: 'solar' as const,
      repeat: 'yearly' as const,
      displayMode: 'auto' as const,
      anchorYmd: '2020-10-01',
      lunarMonth: null,
      lunarDay: null,
      lunarLeap: false,
      catalogKey: 'cn.national-day',
    };
    expect(computeOccurrence(input, '2026-10-01').headline.kind).toBe('today');
    expect(computeOccurrence(input, '2026-10-02').nextYmd).toBe('2027-10-01');
  });
});
