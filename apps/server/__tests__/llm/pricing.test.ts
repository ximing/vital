import { describe, expect, it } from 'vitest';
import type { Api, Model } from '@earendil-works/pi-ai';
import { applyModelPricing, costMicrosFromUsage, modelIsPriced } from '../../src/llm/pricing.js';

function modelWithCost(cost: Model<Api>['cost']): Model<Api> {
  return {
    id: 'm',
    name: 'm',
    api: 'openai-completions',
    provider: 'custom',
    baseUrl: 'http://example.test',
    reasoning: false,
    input: ['text'],
    cost,
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

describe('applyModelPricing', () => {
  it('leaves catalog cost (and tiers) alone when there is no overlay', () => {
    const model = modelWithCost({
      input: 0.15,
      output: 0.6,
      cacheRead: 0.075,
      cacheWrite: 0,
      tiers: [{ inputTokensAbove: 1000, input: 0.3, output: 1.2, cacheRead: 0.15, cacheWrite: 0 }],
    });
    expect(applyModelPricing(model, undefined, 'UTC')).toBe(model);
    expect(modelIsPriced(model)).toBe(true);
  });

  it('flattens an overlay onto catalog fields and drops volume tiers', () => {
    const model = modelWithCost({
      input: 0.15,
      output: 0.6,
      cacheRead: 0.075,
      cacheWrite: 0,
      tiers: [{ inputTokensAbove: 1000, input: 0.3, output: 1.2, cacheRead: 0.15, cacheWrite: 0 }],
    });
    const priced = applyModelPricing(model, { input: 1 }, 'UTC');
    expect(priced).not.toBe(model);
    expect(priced.cost).toEqual({ input: 1, output: 0.6, cacheRead: 0.075, cacheWrite: 0 });
    expect('tiers' in priced.cost).toBe(false);
  });

  it('selects an overnight window in the account timezone', () => {
    const model = modelWithCost({ input: 1, output: 4, cacheRead: 0, cacheWrite: 0 });
    const overlay = {
      windows: [{ start: '22:00', end: '08:00', input: 0.1, output: 0.4 }],
    };
    const night = applyModelPricing(
      model,
      overlay,
      'Asia/Shanghai',
      new Date('2026-01-15T14:30:00.000Z'),
    );
    expect(night.cost).toMatchObject({ input: 0.1, output: 0.4 });
    const day = applyModelPricing(
      model,
      overlay,
      'Asia/Shanghai',
      new Date('2026-01-15T02:00:00.000Z'),
    );
    expect(day).toBe(model);
  });

  it('bills overlay rates against returned tokens even when usage.cost is zero', () => {
    const model = applyModelPricing(
      modelWithCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
      { input: 1, output: 2 },
      'UTC',
    );
    expect(
      costMicrosFromUsage(model, {
        input: 1_000_000,
        output: 500_000,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1_500_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      }),
    ).toBe(2_000_000);
  });
});
