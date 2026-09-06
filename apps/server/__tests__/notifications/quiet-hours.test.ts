import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { applyQuietHours, isInQuietHours } from '../../src/notifications/quiet-hours.js';

const TZ = 'Asia/Shanghai';

describe('quiet hours', () => {
  it('same-day window', () => {
    const noon = DateTime.fromISO('2026-09-06T04:00:00.000Z').toJSDate(); // 12:00 CST
    expect(isInQuietHours(noon, '12:00', '13:00', TZ)).toBe(true);
    expect(isInQuietHours(noon, '13:00', '14:00', TZ)).toBe(false);
    const delayed = applyQuietHours(noon, '12:00', '13:00', TZ);
    expect(DateTime.fromJSDate(delayed, { zone: TZ }).hour).toBe(13);
  });

  it('treats equal start/end as off', () => {
    const noon = DateTime.fromISO('2026-09-06T04:00:00.000Z').toJSDate();
    expect(isInQuietHours(noon, '12:00', '12:00', TZ)).toBe(false);
  });
});
