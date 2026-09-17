import { describe, expect, it } from 'vitest';
import {
  emptyLlmModelPricingDraft,
  parseLlmModelPricingDraft,
  parseLlmModelPricingMap,
} from '@vital/dto';
import { parseModelParameters, parseRouteKey, routeKey } from '../../../src/features/settings/llm';

describe('llm settings helpers', () => {
  it('round-trips provider and model in a route key', () => {
    expect(routeKey('prov-1', 'glm-4-flash')).toBe('prov-1::glm-4-flash');
    expect(parseRouteKey('prov-1::glm-4-flash')).toEqual({
      providerId: 'prov-1',
      model: 'glm-4-flash',
    });
    expect(parseRouteKey('')).toBeNull();
    expect(parseRouteKey('no-sep')).toBeNull();
    expect(parseRouteKey('::model')).toBeNull();
  });

  it('parses per-model JSON parameters', () => {
    expect(
      parseModelParameters(['a', 'b'], {
        a: '{"temperature":0.2}',
        b: '',
      }),
    ).toEqual({ a: { temperature: 0.2 }, b: {} });
  });

  it('rejects invalid parameter JSON', () => {
    expect(() => parseModelParameters(['a'], { a: '{not json' })).toThrow(/JSON/);
  });

  it('parses per-model pricing drafts including overnight windows', () => {
    const draft = emptyLlmModelPricingDraft();
    draft.input = '1';
    draft.output = '2';
    draft.windows = [
      {
        start: '22:00',
        end: '08:00',
        input: '0.1',
        output: '',
        cacheRead: '',
        cacheWrite: '',
      },
    ];
    expect(parseLlmModelPricingDraft(draft)).toEqual({
      input: 1,
      output: 2,
      windows: [{ start: '22:00', end: '08:00', input: 0.1 }],
    });
    expect(parseLlmModelPricingMap(['a', 'b'], { a: draft, b: emptyLlmModelPricingDraft() })).toEqual({
      a: {
        input: 1,
        output: 2,
        windows: [{ start: '22:00', end: '08:00', input: 0.1 }],
      },
    });
  });
});
