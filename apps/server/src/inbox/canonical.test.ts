import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, sha256Hex } from './canonical.js';

describe('canonicalizeUrl', () => {
  it('strips fragment, lowercases host, drops utm_*, trailing slash except /', () => {
    expect(canonicalizeUrl('HTTPS://News.Example.COM/a/b/?utm_source=x&q=1#frag')).toBe(
      'https://news.example.com/a/b?q=1',
    );
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
    expect(canonicalizeUrl('https://example.com/path/')).toBe('https://example.com/path');
    expect(canonicalizeUrl('https://example.com/path/?utm_campaign=z')).toBe(
      'https://example.com/path',
    );
  });

  it('sha256 hex is 64 chars', () => {
    expect(sha256Hex('https://example.com/')).toHaveLength(64);
  });
});
