import { describe, expect, it } from 'vitest';
import {
  compactLlmModelPricingMap,
  llmModelPricingMapSchema,
  llmModelPricingToDraft,
  minutesInHmWindow,
  minutesOfDayInZone,
  parseLlmModelPricingDraft,
  parseLlmModelPricingMap,
  resolveLlmCost,
  type LlmResolvedCost,
} from '../src/llm-pricing.js';

const catalog: LlmResolvedCost = { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 };

describe('minutesInHmWindow', () => {
  it('covers a same-day range inclusive of start and exclusive of end', () => {
    expect(minutesInHmWindow(30, '00:30', '08:30')).toBe(true);
    expect(minutesInHmWindow(8 * 60 + 29, '00:30', '08:30')).toBe(true);
    expect(minutesInHmWindow(8 * 60 + 30, '00:30', '08:30')).toBe(false);
    expect(minutesInHmWindow(29, '00:30', '08:30')).toBe(false);
  });

  it('wraps past midnight', () => {
    expect(minutesInHmWindow(22 * 60, '22:00', '08:00')).toBe(true);
    expect(minutesInHmWindow(0, '22:00', '08:00')).toBe(true);
    expect(minutesInHmWindow(8 * 60 - 1, '22:00', '08:00')).toBe(true);
    expect(minutesInHmWindow(8 * 60, '22:00', '08:00')).toBe(false);
    expect(minutesInHmWindow(21 * 60 + 59, '22:00', '08:00')).toBe(false);
  });
});

describe('resolveLlmCost', () => {
  it('keeps the catalog when no overlay is stored', () => {
    expect(resolveLlmCost(catalog, undefined, new Date(), 'Asia/Shanghai')).toEqual({
      cost: catalog,
      source: 'catalog',
    });
  });

  it('merges default overlay onto catalog field-by-field', () => {
    expect(
      resolveLlmCost(catalog, { input: 1, output: 2 }, new Date('2026-01-15T02:00:00.000Z'), 'UTC'),
    ).toEqual({
      source: 'overlay',
      cost: { input: 1, output: 2, cacheRead: 0.075, cacheWrite: 0 },
    });
  });

  it('uses a matching window and falls back to catalog outside it when no default rates exist', () => {
    const overlay = {
      windows: [{ start: '22:00', end: '08:00', input: 0.05, output: 0.2 }],
    };
    // 14:30 UTC = 22:30 Asia/Shanghai
    expect(
      resolveLlmCost(catalog, overlay, new Date('2026-01-15T14:30:00.000Z'), 'Asia/Shanghai'),
    ).toEqual({
      source: 'overlay',
      cost: { input: 0.05, output: 0.2, cacheRead: 0.075, cacheWrite: 0 },
    });
    // 02:00 UTC = 10:00 Asia/Shanghai
    expect(
      resolveLlmCost(catalog, overlay, new Date('2026-01-15T02:00:00.000Z'), 'Asia/Shanghai'),
    ).toEqual({ cost: catalog, source: 'catalog' });
  });

  it('uses default overlay rates outside a window', () => {
    const overlay = {
      input: 1,
      output: 4,
      windows: [{ start: '00:00', end: '08:00', input: 0.2, output: 0.8 }],
    };
    expect(
      resolveLlmCost(catalog, overlay, new Date('2026-01-15T04:00:00.000Z'), 'UTC'),
    ).toMatchObject({ source: 'overlay', cost: { input: 0.2, output: 0.8 } });
    expect(
      resolveLlmCost(catalog, overlay, new Date('2026-01-15T12:00:00.000Z'), 'UTC'),
    ).toMatchObject({ source: 'overlay', cost: { input: 1, output: 4 } });
  });
});

describe('minutesOfDayInZone', () => {
  it('converts UTC to Asia/Shanghai', () => {
    expect(minutesOfDayInZone(new Date('2026-01-15T16:00:00.000Z'), 'Asia/Shanghai')).toBe(0);
    expect(minutesOfDayInZone(new Date('2026-01-15T14:30:00.000Z'), 'Asia/Shanghai')).toBe(22 * 60 + 30);
  });
});

describe('pricing drafts and schema', () => {
  it('round-trips a draft and drops empty windows', () => {
    const parsed = parseLlmModelPricingDraft({
      input: '1',
      output: ' 2 ',
      cacheRead: '',
      cacheWrite: '',
      windows: [
        { start: '22:00', end: '08:00', input: '0.1', output: '', cacheRead: '', cacheWrite: '' },
        { start: '', end: '', input: '', output: '', cacheRead: '', cacheWrite: '' },
      ],
    });
    expect(parsed).toEqual({
      input: 1,
      output: 2,
      windows: [{ start: '22:00', end: '08:00', input: 0.1 }],
    });
    expect(llmModelPricingToDraft(parsed).windows).toHaveLength(1);
  });

  it('rejects a window with times but no rates', () => {
    expect(() =>
      parseLlmModelPricingDraft({
        input: '',
        output: '',
        cacheRead: '',
        cacheWrite: '',
        windows: [{ start: '00:00', end: '08:00', input: '', output: '', cacheRead: '', cacheWrite: '' }],
      }),
    ).toThrow(/时段至少填写一个单价/);
  });

  it('compacts a map to models that still have an overlay', () => {
    expect(
      compactLlmModelPricingMap(
        {
          keep: { input: 1 },
          gone: { output: 2 },
          empty: {},
        },
        ['keep', 'empty'],
      ),
    ).toEqual({ keep: { input: 1 } });
    expect(parseLlmModelPricingMap(['a'], { a: llmModelPricingToDraft() })).toBeUndefined();
  });

  it('rejects identical window bounds', () => {
    expect(
      llmModelPricingMapSchema.safeParse({
        m: { windows: [{ start: '08:00', end: '08:00', input: 1 }] },
      }).success,
    ).toBe(false);
  });
});
