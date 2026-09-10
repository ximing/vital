import { describe, expect, it } from 'vitest';
import { scheduleDeadline } from '../../src/agent/scheduling.js';

const now = new Date('2026-09-10T00:00:00Z');
describe('persisted scheduling deadlines', () => {
  it('debounces cluster by two minutes and retains the cooldown', () => {
    expect(scheduleDeadline('outcome.cluster', now, null, 4, false, null)).toEqual(new Date(+now + 120_000));
    expect(scheduleDeadline('outcome.cluster', now, null, 4, false, new Date(+now + 1_800_000))).toEqual(new Date(+now + 1_800_000));
  });
  it('keeps small feedback batches for 24 hours without pushing their first deadline', () => {
    expect(scheduleDeadline('memory.distill', new Date(+now + 60_000), now, 2, false, null)).toEqual(new Date(+now + 86_400_000));
  });
  it('three feedback entries or a correction uses five minute debounce', () => {
    expect(scheduleDeadline('memory.distill', now, null, 3, false, null)).toEqual(new Date(+now + 300_000));
    expect(scheduleDeadline('memory.distill', now, null, 1, true, null)).toEqual(new Date(+now + 300_000));
  });
});
