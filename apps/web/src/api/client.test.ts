import { afterEach, describe, expect, it } from 'vitest';
import { AUTH_CLEARED_EVENT, tokenStore } from './client';

describe('cookie tokenStore', () => {
  afterEach(() => {
    tokenStore.clear();
  });

  it('keeps access in memory and never stores a refresh token', async () => {
    tokenStore.setTokens({ accessToken: 'a1', refreshToken: 'leak', expiresIn: 900 });
    expect(await tokenStore.getAccessToken()).toBe('a1');
    expect(await tokenStore.getRefreshToken()).toBeNull();
  });

  it('clear dispatches vital:auth-cleared', async () => {
    tokenStore.setTokens({ accessToken: 'a1', expiresIn: 900 });
    let fired = 0;
    const onClear = () => {
      fired += 1;
    };
    window.addEventListener(AUTH_CLEARED_EVENT, onClear);
    tokenStore.clear();
    window.removeEventListener(AUTH_CLEARED_EVENT, onClear);
    expect(await tokenStore.getAccessToken()).toBeNull();
    expect(fired).toBe(1);
  });
});
