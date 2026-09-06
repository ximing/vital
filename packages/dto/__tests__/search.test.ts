import { describe, expect, it } from 'vitest';
import { searchInputSchema } from '../src/search.js';

describe('searchInputSchema', () => {
  it('trims q and caps limit at 50', () => {
    expect(searchInputSchema.parse({ q: '  牛奶  ' }).q).toBe('牛奶');
    expect(searchInputSchema.safeParse({ q: 'x', limit: 51 }).success).toBe(false);
    expect(searchInputSchema.parse({ q: 'task', types: ['task'], limit: 20 }).limit).toBe(20);
    expect(searchInputSchema.parse({ q: '稍后', types: ['inbox'] }).types).toEqual(['inbox']);
    expect(searchInputSchema.parse({ q: '日报', types: ['report'] }).types).toEqual(['report']);
  });
});
