import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthTokens } from '@vital/dto';
import {
  AUTH_CLEARED_EVENT,
  createAppClient,
  createCookieTokenStore,
  createTauriTokenStore,
  isTauriRuntime,
  TAURI_DEV_API_URL,
  tauriBaseUrl,
  tokenStore,
  type TauriKv,
} from '../../src/api/client';

function memoryKv(initial: Record<string, unknown> = {}): TauriKv & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: async (key) => data.get(key),
    set: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
    save: async () => {},
  };
}

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

describe('Tauri runtime client', () => {
  it('detects window.__TAURI_INTERNALS__', () => {
    expect(isTauriRuntime({})).toBe(false);
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(isTauriRuntime(window)).toBe(false);
  });

  it('uses absolute 127.0.0.1:3010 in dev and requires VITE_TAURI_API_URL in prod', () => {
    expect(tauriBaseUrl({ DEV: true })).toBe(TAURI_DEV_API_URL);
    expect(tauriBaseUrl({ DEV: false, VITE_TAURI_API_URL: 'https://vital.example/' })).toBe(
      'https://vital.example',
    );
    expect(() => tauriBaseUrl({ DEV: false })).toThrow(/VITE_TAURI_API_URL/);
    expect(() => tauriBaseUrl({ DEV: false, VITE_TAURI_API_URL: '   ' })).toThrow(
      /VITE_TAURI_API_URL/,
    );
  });

  it('plugin-store TokenStore persists access + refresh and clears both', async () => {
    const kv = memoryKv();
    const store = createTauriTokenStore(kv);
    const tokens: AuthTokens = { accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 };
    await store.setTokens(tokens);
    expect(kv.data.get('accessToken')).toBe('a1');
    expect(kv.data.get('refreshToken')).toBe('r1');
    expect(await store.getAccessToken()).toBe('a1');
    expect(await store.getRefreshToken()).toBe('r1');

    let fired = 0;
    const onClear = () => {
      fired += 1;
    };
    window.addEventListener(AUTH_CLEARED_EVENT, onClear);
    await store.clear();
    window.removeEventListener(AUTH_CLEARED_EVENT, onClear);
    expect(await store.getAccessToken()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();
    expect(kv.data.size).toBe(0);
    expect(fired).toBe(1);
  });

  it('Tauri VitalClient is bearer with plugin fetchImpl and absolute baseUrl', async () => {
    const kv = memoryKv();
    const store = createTauriTokenStore(kv);
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const href = String(url);
      if (href.endsWith('/login')) {
        return new Response(
          JSON.stringify({
            user: {
              id: 'u1',
              email: 'a@b.c',
              displayName: 'A',
              timezone: 'Asia/Shanghai',
              locale: 'zh-CN',
              themePreference: 'system',
              weekStartsOn: 1,
              convertArchiveOnComplete: true,
              notifications: {
                taskRemind: true,
                taskDue: true,
                quietHoursStart: null,
                quietHoursEnd: null,
                allDayNotifyTime: '09:00',
              },
              onboarding: {},
              llm: { apiBase: null, model: null, apiKeySet: false },
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            tokens: { accessToken: 'a1', refreshToken: 'r1', expiresIn: 900 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(null, { status: 204 });
    });
    const client = createAppClient({
      isTauri: true,
      tokenStore: store,
      fetchImpl,
      env: { DEV: true },
    });
    expect(client.authMode).toBe('bearer');
    await client.login({ email: 'a@b.c', password: 'secret123' });
    expect(await store.getRefreshToken()).toBe('r1');
    const loginUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(loginUrl).toBe('http://127.0.0.1:3010/api/v1/auth/login');
    expect(fetchImpl.mock.calls[0]?.[1]?.credentials).toBe('omit');
  });

  it('browser VitalClient stays cookie + relative baseUrl', async () => {
    const store = createCookieTokenStore();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = createAppClient({ isTauri: false, tokenStore: store, fetchImpl });
    expect(client.authMode).toBe('cookie');
    await client.logout();
    const logoutUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(logoutUrl).toBe('/api/v1/auth/logout');
    expect(fetchImpl.mock.calls[0]?.[1]?.credentials).toBe('include');
  });
});
