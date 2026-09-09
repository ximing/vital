import { describe, expect, it } from 'vitest';
import {
  API_TOKEN_PREFIX,
  createApiTokenInputSchema,
  isApiTokenSecret,
  listApiTokenAccessQuerySchema,
} from '../src/tokens.js';

describe('api tokens dto', () => {
  it('accepts a trimmed name and rejects empty or oversized names', () => {
    expect(createApiTokenInputSchema.parse({ name: '  Claude  ' }).name).toBe('Claude');
    expect(() => createApiTokenInputSchema.parse({ name: '' })).toThrow();
    expect(() => createApiTokenInputSchema.parse({ name: 'x'.repeat(51) })).toThrow();
  });

  it('detects vt_ secrets and defaults access-log pagination', () => {
    expect(isApiTokenSecret(`${API_TOKEN_PREFIX}${'a'.repeat(20)}`)).toBe(true);
    expect(isApiTokenSecret('eyJhbGciOiJIUzI1NiJ9.xx.yy')).toBe(false);
    expect(listApiTokenAccessQuerySchema.parse({}).limit).toBe(50);
    expect(listApiTokenAccessQuerySchema.parse({ limit: '10' }).limit).toBe(10);
  });
});
