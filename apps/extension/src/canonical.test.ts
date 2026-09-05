import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, idempotencyKeyForUrl, sha256Hex } from './canonical.js';

describe('canonicalizeUrl', () => {
  it('strips fragment, lowercases host, drops utm_*, strips trailing slash', () => {
    expect(canonicalizeUrl('https://News.Example.com/path/?utm_source=x#frag')).toBe(
      'https://news.example.com/path',
    );
    expect(canonicalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('keeps non-utm query params', () => {
    expect(canonicalizeUrl('https://ex.com/a?id=1&utm_medium=x&ref=2')).toBe(
      'https://ex.com/a?id=1&ref=2',
    );
  });
});

describe('idempotencyKeyForUrl', () => {
  it('is sha256 of the canonical URL (64 hex)', async () => {
    const raw = 'https://News.Example.com/path/?utm_source=x#frag';
    const { canonicalUrl, key } = await idempotencyKeyForUrl(raw);
    expect(canonicalUrl).toBe('https://news.example.com/path');
    expect(key).toBe(await sha256Hex(canonicalUrl));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
