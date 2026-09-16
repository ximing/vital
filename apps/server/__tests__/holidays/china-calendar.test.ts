import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/db/index.js';
import { holidayCalendar } from '../../src/db/schema.js';
import {
  chinaCalendarLookupFromWindow,
  loadChinaCalendarWindow,
  matchesChinaRule,
} from '../../src/holidays/china-calendar.js';
import { resetDb } from '../helpers/db.js';

describe('China calendar rules', () => {
  const lookup = (date: string) =>
    Promise.resolve(
      date === '2026-10-01' ? ('holiday' as const) : date === '2026-02-21' ? ('workday' as const) : null,
    );

  it('uses statutory holidays and make-up workdays before weekday fallback', async () => {
    await expect(matchesChinaRule('2026-10-01', 'holidays', lookup)).resolves.toBe(true);
    await expect(matchesChinaRule('2026-02-21', 'legal_workdays', lookup)).resolves.toBe(true);
    await expect(matchesChinaRule('2032-01-05', 'legal_workdays', lookup)).resolves.toBe(true);
  });

  it('window lookup matches per-day semantics at inclusive bounds and ignores dates outside', async () => {
    const map = new Map([
      ['2026-10-01', 'holiday' as const],
      ['2026-10-07', 'holiday' as const],
      ['2026-10-10', 'workday' as const],
    ]);
    const window = chinaCalendarLookupFromWindow(map);
    await expect(matchesChinaRule('2026-10-01', 'holidays', window)).resolves.toBe(true);
    await expect(matchesChinaRule('2026-10-07', 'holidays', window)).resolves.toBe(true);
    await expect(matchesChinaRule('2026-10-10', 'legal_workdays', window)).resolves.toBe(true);
    await expect(matchesChinaRule('2026-09-30', 'holidays', window)).resolves.toBe(false);
    await expect(matchesChinaRule('2026-10-08', 'holidays', window)).resolves.toBe(false);
    // Thursday 2026-10-08 is a weekday, so legal_workdays falls back when unset.
    await expect(matchesChinaRule('2026-10-08', 'legal_workdays', window)).resolves.toBe(true);
  });
});

describe('China calendar window query', () => {
  beforeEach(resetDb);

  it('loads only rows inside the inclusive date window', async () => {
    await getDb()
      .insert(holidayCalendar)
      .values([
        { region: 'CN', date: '2026-09-30', kind: 'holiday', sourceVersion: 'test' },
        { region: 'CN', date: '2026-10-01', kind: 'holiday', sourceVersion: 'test' },
        { region: 'CN', date: '2026-10-07', kind: 'holiday', sourceVersion: 'test' },
        { region: 'CN', date: '2026-10-08', kind: 'workday', sourceVersion: 'test' },
      ]);
    const map = await loadChinaCalendarWindow('2026-10-01', '2026-10-07');
    expect([...map.entries()].sort()).toEqual([
      ['2026-10-01', 'holiday'],
      ['2026-10-07', 'holiday'],
    ]);
    const lookup = chinaCalendarLookupFromWindow(map);
    await expect(matchesChinaRule('2026-10-01', 'holidays', lookup)).resolves.toBe(true);
    await expect(matchesChinaRule('2026-09-30', 'holidays', lookup)).resolves.toBe(false);
    await expect(matchesChinaRule('2026-10-08', 'legal_workdays', lookup)).resolves.toBe(true);
  });
});

