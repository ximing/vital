import { describe, expect, it } from 'vitest';
import {
  createInboxInputSchema,
  extractInboxInputSchema,
  idempotencyKeySchema,
  MAX_INBOX_ASSETS,
  patchInboxAssetsInputSchema,
  patchInboxInputSchema,
} from './inbox.js';

describe('extractInboxInputSchema', () => {
  it('accepts http(s) and rejects file/gopher', () => {
    expect(extractInboxInputSchema.parse({ url: 'https://Example.com/a' }).url).toBe(
      'https://Example.com/a',
    );
    expect(extractInboxInputSchema.safeParse({ url: 'file:///etc/passwd' }).success).toBe(false);
    expect(extractInboxInputSchema.safeParse({ url: 'gopher://x' }).success).toBe(false);
  });
});

describe('createInboxInputSchema', () => {
  it('requires title; optional http originalUrl', () => {
    expect(createInboxInputSchema.parse({ title: '  Hello  ' }).title).toBe('Hello');
    expect(
      createInboxInputSchema.safeParse({ title: 'x', originalUrl: 'javascript:alert(1)' }).success,
    ).toBe(false);
  });
});

describe('patchInboxInputSchema', () => {
  it('omit vs null: empty rejected, excerpt null allowed; converted status rejected', () => {
    expect(patchInboxInputSchema.safeParse({}).success).toBe(false);
    expect(patchInboxInputSchema.parse({ excerpt: null })).toEqual({ excerpt: null });
    expect(patchInboxInputSchema.safeParse({ status: 'converted' }).success).toBe(false);
  });
});

describe('patchInboxAssetsInputSchema', () => {
  it('caps assets at 10', () => {
    expect(MAX_INBOX_ASSETS).toBe(10);
    const asset = {
      attachmentId: '11111111-1111-4111-8111-111111111111',
      originalSrc: 'https://x/a.png',
      sortOrder: 0,
    };
    expect(patchInboxAssetsInputSchema.parse({ assets: [asset] }).assets).toHaveLength(1);
    expect(
      patchInboxAssetsInputSchema.safeParse({
        assets: Array.from({ length: 11 }, (_, i) => ({ ...asset, sortOrder: i })),
      }).success,
    ).toBe(false);
  });
});

describe('idempotencyKeySchema', () => {
  it('requires 64 hex and lowercases', () => {
    const hex = 'A'.repeat(64);
    expect(idempotencyKeySchema.parse(hex)).toBe('a'.repeat(64));
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
  });
});
