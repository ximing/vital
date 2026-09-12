import { describe, expect, it } from 'vitest';
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
});
