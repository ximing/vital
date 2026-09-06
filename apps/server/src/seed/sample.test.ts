import { describe, expect, it } from 'vitest';
import { assertDevelopmentSeed, SAMPLE_TAG, SAMPLE_TITLES } from './guard.js';

describe('dev seed', () => {
  it('refuses non-development NODE_ENV', () => {
    expect(() => {
      assertDevelopmentSeed('production');
    }).toThrow('SEED_DEV_ONLY');
    expect(() => {
      assertDevelopmentSeed('test');
    }).toThrow('SEED_DEV_ONLY');
    expect(() => {
      assertDevelopmentSeed('development');
    }).not.toThrow();
  });

  it('ships three #sample titles', () => {
    expect(SAMPLE_TAG).toBe('sample');
    expect(SAMPLE_TITLES).toHaveLength(3);
    expect(new Set(SAMPLE_TITLES).size).toBe(3);
  });
});
