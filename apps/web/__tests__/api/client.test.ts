import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_CLEARED_EVENT,
  createAppClient,
  createCookieTokenStore,
  tokenStore,
} from '../../src/api/client';

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

describe('web client', () => {
  it('stays cookie with a relative baseUrl', async () => {
    const store = createCookieTokenStore();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = createAppClient({ tokenStore: store, fetchImpl });
    expect(client.authMode).toBe('cookie');
    await client.logout();
    const logoutUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(logoutUrl).toBe('/api/v1/auth/logout');
    expect(fetchImpl.mock.calls[0]?.[1]?.credentials).toBe('include');
  });
});
