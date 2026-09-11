import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_PATH,
  EVAL_WINDOW_DAYS,
  buildSnapshot,
  diffSnapshots,
} from '../../scripts/eval/core.js';

describe('agent eval runner', () => {
  it('produces identical snapshots for the same fixture (deterministic, date-normalized)', async () => {
    const first = await buildSnapshot();
    const second = await buildSnapshot();
    expect(second).toEqual(first);
    expect(diffSnapshots(first, second)).toEqual([]);
  });

  it('the committed baseline matches a fresh run — regenerate with `pnpm eval:agent --update` when a change is intentional', async () => {
    const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as unknown;
    const fresh = await buildSnapshot();
    expect(diffSnapshots(baseline, fresh)).toEqual([]);
  });

  it('covers the fixed case: headline amortization, undone exclusion, null costPerAdopted', async () => {
    const snapshot = await buildSnapshot();
    expect(snapshot.windowDays).toBe(EVAL_WINDOW_DAYS);
    expect(snapshot.summary).toMatchObject({ proposed: 8, adopted: 4, dismissed: 2, undone: 1 });
    expect(snapshot.perCapability).toEqual([
      // One headline run (600 micros) amortized over its two adopted proposals.
      { capability: 'headline', costMicros: 600, adopted: 2, costPerAdoptedMicros: 300 },
      { capability: 'cluster', costMicros: 900, adopted: 1, costPerAdoptedMicros: 900 },
      // The undone decompose never counts as adopted.
      { capability: 'decompose', costMicros: 300, adopted: 1, costPerAdoptedMicros: 300 },
      // Draft has a pending proposal only — nothing adopted, cost cannot be amortized.
      { capability: 'draft', costMicros: 100, adopted: 0, costPerAdoptedMicros: null },
    ]);
  });

  it('a tampered feedback (accepted → dismissed) is what --check must catch', async () => {
    const baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')) as unknown;
    const tampered = await buildSnapshot({ tamper: true });
    const diff = diffSnapshots(baseline, tampered);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.join('\n')).toContain('adopted');
    expect(tampered.summary.adopted).toBe(3);
    expect(tampered.perCapability.find((row) => row.capability === 'headline')).toMatchObject({
      adopted: 1,
      costPerAdoptedMicros: 600,
    });
  });
});
