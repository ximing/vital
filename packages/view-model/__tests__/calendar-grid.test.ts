import { describe, expect, it } from 'vitest';
import { monthGrid } from '../src/index.js';

function filled(cells: (string | null)[]): string[] {
  return cells.filter((cell): cell is string => cell !== null);
}

describe('monthGrid', () => {
  it('pads January 2026 from Sunday or Monday without leaking into another year', () => {
    const sunday = monthGrid(2026, 1, 0);
    const monday = monthGrid(2026, 1, 1);
    expect(sunday).toHaveLength(42);
    expect(monday).toHaveLength(42);
    expect(sunday.slice(0, 5)).toEqual([null, null, null, null, '2026-01-01']);
    expect(monday.slice(0, 4)).toEqual([null, null, null, '2026-01-01']);
    expect(filled(sunday)).toEqual(filled(monday));
    expect(filled(sunday)[0]).toBe('2026-01-01');
    expect(filled(sunday).at(-1)).toBe('2026-01-31');
    expect(filled(sunday).every((cell) => cell.startsWith('2026-01-'))).toBe(true);
  });

  it('fits February, including a 29-day leap year', () => {
    const feb = monthGrid(2026, 2, 0);
    const days = filled(feb);
    expect(feb[0]).toBe('2026-02-01');
    expect(days).toHaveLength(28);
    expect(days.at(-1)).toBe('2026-02-28');
    expect(monthGrid(2026, 2, 1).slice(0, 7)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      '2026-02-01',
    ]);
    const leap = filled(monthGrid(2024, 2, 1));
    expect(leap).toHaveLength(29);
    expect(leap[0]).toBe('2024-02-01');
    expect(leap.at(-1)).toBe('2024-02-29');
  });

  it('stays inside December when the month sits on the year boundary', () => {
    const sunday = monthGrid(2025, 12, 0);
    const monday = monthGrid(2025, 12, 1);
    expect(sunday[0]).toBeNull();
    expect(sunday[1]).toBe('2025-12-01');
    expect(monday[0]).toBe('2025-12-01');
    const days = filled(sunday);
    expect(days).toEqual(filled(monday));
    expect(days).toHaveLength(31);
    expect(days.at(-1)).toBe('2025-12-31');
    expect(days.every((cell) => cell.startsWith('2025-12-'))).toBe(true);
  });
});
