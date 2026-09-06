import { describe, expect, it } from 'vitest';
import { listIdSchema, patchListInputSchema, SMART_LIST_IDS } from '../src/lists.js';

describe('listIdSchema', () => {
  it('accepts uuid and smart ids', () => {
    expect(listIdSchema.parse('11111111-1111-4111-8111-111111111111')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    for (const id of SMART_LIST_IDS) {
      expect(listIdSchema.parse(id)).toBe(id);
    }
  });

  it('rejects unknown smart ids', () => {
    expect(listIdSchema.safeParse('smart:other').success).toBe(false);
    expect(listIdSchema.safeParse('not-a-list').success).toBe(false);
  });
});

describe('patchListInputSchema', () => {
  it('rejects empty patch; null clears color', () => {
    expect(patchListInputSchema.safeParse({}).success).toBe(false);
    expect(patchListInputSchema.parse({ color: null })).toEqual({ color: null });
  });
});
