import { describe, expect, it } from 'vitest';
import { syncChangesQuerySchema } from '../src/sync.js';

describe('syncChangesQuerySchema', () => {
  it('requires a parseable since and defaults limit to 200', () => {
    const parsed = syncChangesQuerySchema.parse({ since: '2026-09-01T00:00:00.000Z' });
    expect(parsed.since).toBe('2026-09-01T00:00:00.000Z');
    expect(parsed.limit).toBe(200);
  });

  it('rejects missing or invalid since and out-of-range limit', () => {
    expect(syncChangesQuerySchema.safeParse({}).success).toBe(false);
    expect(syncChangesQuerySchema.safeParse({ since: 'yesterday' }).success).toBe(false);
    expect(syncChangesQuerySchema.safeParse({ since: '2026-09-01T00:00:00.000Z', limit: '0' }).success).toBe(
      false,
    );
    expect(syncChangesQuerySchema.safeParse({ since: '2026-09-01T00:00:00.000Z', limit: '501' }).success).toBe(
      false,
    );
  });
});
