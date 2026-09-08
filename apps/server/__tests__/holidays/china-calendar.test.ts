import { describe, expect, it } from 'vitest';
import { matchesChinaRule } from '../../src/holidays/china-calendar.js';

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
});
