import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../../src/db/pg.js';

function withCode(code: string): Error & { code: string } {
  const err = new Error('duplicate key') as Error & { code: string };
  err.code = code;
  return err;
}

describe('isUniqueViolation', () => {
  it('unwraps DrizzleQueryError.cause and nested cause to find 23505', () => {
    const pg = withCode('23505');
    const drizzle = new Error('Failed query: insert');
    drizzle.cause = pg;
    const tx = new Error('transaction failed');
    tx.cause = drizzle;
    expect(isUniqueViolation(pg)).toBe(true);
    expect(isUniqueViolation(drizzle)).toBe(true);
    expect(isUniqueViolation(tx)).toBe(true);
    expect(isUniqueViolation(withCode('23503'))).toBe(false);
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
