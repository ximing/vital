import { describe, expect, it } from 'vitest';
import { createCoalescedRunner } from '../../src/lib/coalesce';

describe('createCoalescedRunner', () => {
  it('runs a call that arrives mid-flight after the current one finishes', async () => {
    const run = createCoalescedRunner();
    const seen: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = run(async () => {
      seen.push('first');
      await gate;
    });
    const second = run(async () => {
      seen.push('second');
    });
    release();
    await first;
    await second;

    expect(seen).toEqual(['first', 'second']);
  });
});
