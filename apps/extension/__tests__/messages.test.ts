import { describe, expect, it } from 'vitest';
import { isOffscreenParse, isPanelRequest } from '../src/messages.js';

describe('message guards', () => {
  it('accepts panel and offscreen shapes', () => {
    expect(isPanelRequest({ type: 'open-login' })).toBe(true);
    expect(isPanelRequest({ type: 'exchange-code', code: 'abc' })).toBe(true);
    expect(isPanelRequest({ type: 'login', email: 'a@b.c', password: 'x' })).toBe(false);
    expect(isPanelRequest({ type: 'nope' })).toBe(false);
    expect(
      isOffscreenParse({ type: 'parse', target: 'offscreen', html: '<p>', url: 'https://x' }),
    ).toBe(true);
    expect(isOffscreenParse({ type: 'parse', html: '<p>', url: 'https://x' })).toBe(false);
  });
});
