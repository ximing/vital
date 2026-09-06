import { describe, expect, it } from 'vitest';
import { Semaphore } from '../../src/extract/semaphore.js';

describe('Semaphore', () => {
  it('caps concurrent holders at max', async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const job = async () => {
      await sem.acquire();
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 30));
      running -= 1;
      sem.release();
    };
    await Promise.all([job(), job(), job(), job()]);
    expect(peak).toBe(2);
    expect(sem.running).toBe(0);
  });
});
