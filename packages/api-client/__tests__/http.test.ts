import {
  DEFAULT_NOTIFICATION_PREFS,
  type AuthMode,
  type AuthResponse,
  type AuthTokens,
  type UserProfile,
} from '@vital/dto';
import { describe, expect, it } from 'vitest';
import { ApiError, Http, type VitalClientOptions } from '../src/http.js';
import {
  authorizationOf,
  bodyOf,
  memoryStore,
  respond,
  respond204,
  urlOf,
} from './test-helpers.js';
import type { TokenStore } from '../src/types.js';

const user: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: 'A',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  convertArchiveOnComplete: true,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function authResponse(tokens: AuthTokens): AuthResponse {
  return { user, tokens };
}

function makeHttp(authMode: AuthMode, store: TokenStore, fetchImpl: typeof fetch): Http {
  const options: VitalClientOptions = {
    baseUrl: 'http://x',
    tokenStore: store,
    authMode,
    fetchImpl,
  };
  return new Http(options);
}

describe('ApiError', () => {
  it('stores status, code, message, details (AppError field order)', () => {
    const err = new ApiError(403, 'CHAIN_ROLE_INSUFFICIENT', '角色不足', { role: 'viewer' });
    expect(err.status).toBe(403);
    expect(err.code).toBe('CHAIN_ROLE_INSUFFICIENT');
    expect(err.message).toBe('角色不足');
    expect(err.details).toEqual({ role: 'viewer' });
    expect(err.name).toBe('ApiError');
  });
});

describe('Http cookie mode', () => {
  it('sends credentials include and Bearer when an access token exists', async () => {
    const store = memoryStore({ accessToken: 'a1', expiresIn: 900 });
    const calls: RequestInit[] = [];
    const http = makeHttp('cookie', store, (_url, init) => {
      calls.push(init ?? {});
      return respond(200, { ok: 1 });
    });
    const data = await http.request<{ ok: number }>('/api/v1/auth/me');
    expect(data.ok).toBe(1);
    expect(calls[0]?.credentials).toBe('include');
    expect(authorizationOf(calls[0])).toBe('Bearer a1');
  });

  it('on 401 refreshes with {} even when getRefreshToken() is null, then replays', async () => {
    const store = memoryStore({ accessToken: 'expired', expiresIn: 900 });
    expect(store.getRefreshToken()).toBeNull();
    const calls: { url: string; init: RequestInit }[] = [];
    const http = makeHttp('cookie', store, (url, init) => {
      const u = urlOf(url);
      calls.push({ url: u, init: init ?? {} });
      if (u.endsWith('/api/v1/auth/refresh')) {
        return respond(200, authResponse({ accessToken: 'new', expiresIn: 900 }));
      }
      if (authorizationOf(init) === 'Bearer expired') {
        return respond(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      }
      return respond(200, { value: 42 });
    });
    const data = await http.request<{ value: number }>('/api/v1/lists');
    expect(data.value).toBe(42);
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/api/v1/lists',
      'http://x/api/v1/auth/refresh',
      'http://x/api/v1/lists',
    ]);
    const refresh = calls[1];
    expect(refresh?.init.method).toBe('POST');
    expect(refresh?.init.credentials).toBe('include');
    expect(authorizationOf(refresh?.init)).toBe('');
    expect(bodyOf(refresh?.init)).toEqual({});
    expect(authorizationOf(calls[2]?.init)).toBe('Bearer new');
    expect(store.tokens?.accessToken).toBe('new');
    expect(store.cleared).toBe(false);
  });

  it('boot with no access token tries cookie refresh once', async () => {
    const store = memoryStore();
    let refreshCount = 0;
    const http = makeHttp('cookie', store, (url, init) => {
      if (urlOf(url).endsWith('/api/v1/auth/refresh')) {
        refreshCount += 1;
        expect(init?.credentials).toBe('include');
        expect(bodyOf(init)).toEqual({});
        expect(authorizationOf(init)).toBe('');
        return respond(200, authResponse({ accessToken: 'booted', expiresIn: 900 }));
      }
      return respond(500, { error: { code: 'NO', message: 'no' } });
    });
    expect(await http.boot()).toBe(true);
    expect(refreshCount).toBe(1);
    expect(store.tokens?.accessToken).toBe('booted');
    expect(await http.boot()).toBe(true);
    expect(refreshCount).toBe(1);
  });

  it('boot returns false and clears when cookie refresh fails', async () => {
    const store = memoryStore();
    const http = makeHttp('cookie', store, (url) => {
      if (urlOf(url).endsWith('/api/v1/auth/refresh')) {
        return respond(401, { error: { code: 'INVALID_TOKEN', message: '登录已过期' } });
      }
      return respond(200, {});
    });
    expect(await http.boot()).toBe(false);
    expect(store.cleared).toBe(true);
  });

  it('concurrent 401s only fire one cookie refresh (single-flight)', async () => {
    const store = memoryStore({ accessToken: 'expired', expiresIn: 900 });
    let refreshCount = 0;
    const http = makeHttp('cookie', store, (url, init) => {
      if (urlOf(url).endsWith('/api/v1/auth/refresh')) {
        refreshCount += 1;
        return respond(200, authResponse({ accessToken: 'new', expiresIn: 900 }));
      }
      if (authorizationOf(init) !== 'Bearer new') {
        return respond(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      }
      return respond(200, { ok: true });
    });
    await Promise.all([http.request('/api/v1/lists'), http.request('/api/v1/auth/me')]);
    expect(refreshCount).toBe(1);
  });

  it('cookie refresh drops refreshToken before setTokens', async () => {
    const store = memoryStore();
    const http = makeHttp('cookie', store, (url) => {
      if (urlOf(url).endsWith('/api/v1/auth/refresh')) {
        return respond(
          200,
          authResponse({ accessToken: 'a1', refreshToken: 'leak', expiresIn: 900 }),
        );
      }
      return respond(500, {});
    });
    const data = await http.refresh();
    expect(store.tokens).toEqual({ accessToken: 'a1', expiresIn: 900 });
    expect(store.tokens?.refreshToken).toBeUndefined();
    expect(data.tokens.refreshToken).toBeUndefined();
  });

});

describe('Http bearer mode', () => {
  it('omits credentials and sends JSON refreshToken on 401', async () => {
    const store = memoryStore({ accessToken: 'expired', refreshToken: 'r1', expiresIn: 900 });
    const calls: { url: string; init: RequestInit }[] = [];
    const http = makeHttp('bearer', store, (url, init) => {
      const u = urlOf(url);
      calls.push({ url: u, init: init ?? {} });
      if (u.endsWith('/api/v1/auth/refresh')) {
        return respond(
          200,
          authResponse({ accessToken: 'new', refreshToken: 'r2', expiresIn: 900 }),
        );
      }
      if (authorizationOf(init) === 'Bearer expired') {
        return respond(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      }
      return respond(200, { value: 1 });
    });
    await http.request('/api/v1/lists');
    expect(calls[0]?.init.credentials).toBe('omit');
    const refresh = calls[1];
    expect(refresh?.init.credentials).toBe('omit');
    expect(authorizationOf(refresh?.init)).toBe('');
    expect(bodyOf(refresh?.init)).toEqual({ refreshToken: 'r1' });
    expect(store.tokens?.refreshToken).toBe('r2');
  });

  it('401 without a refresh-token string does not refresh or clear', async () => {
    const store = memoryStore({ accessToken: 'a', expiresIn: 900 });
    let refreshCount = 0;
    const http = makeHttp('bearer', store, (url) => {
      if (urlOf(url).endsWith('/api/v1/auth/refresh')) {
        refreshCount += 1;
        return respond(200, {});
      }
      return respond(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
    });
    await expect(http.request('/api/v1/lists')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
      status: 401,
    });
    expect(refreshCount).toBe(0);
    expect(store.cleared).toBe(false);
  });

  it('boot without an access token does not refresh', async () => {
    const store = memoryStore();
    let calls = 0;
    const http = makeHttp('bearer', store, () => {
      calls += 1;
      return respond(200, {});
    });
    expect(await http.boot()).toBe(false);
    expect(calls).toBe(0);
  });
});

describe('Http refresh failure and replay', () => {
  it('failed refresh clears and throws the server ApiError', async () => {
    const store = memoryStore({ accessToken: 'expired', refreshToken: 'dead', expiresIn: 900 });
    const http = makeHttp('bearer', store, (url) => {
      if (urlOf(url).endsWith('/api/v1/auth/refresh')) {
        return respond(401, { error: { code: 'INVALID_TOKEN', message: '复用' } });
      }
      return respond(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
    });
    await expect(http.request('/api/v1/lists')).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
      status: 401,
      message: '复用',
    });
    expect(store.cleared).toBe(true);
    expect(store.tokens).toBeNull();
  });

  it('replays once; second 401 clears', async () => {
    const store = memoryStore({ accessToken: 'bad', refreshToken: 'r', expiresIn: 900 });
    let listCalls = 0;
    const http = makeHttp('bearer', store, (url) => {
      if (urlOf(url).endsWith('/api/v1/auth/refresh')) {
        return respond(
          200,
          authResponse({ accessToken: 'still-bad', refreshToken: 'r2', expiresIn: 900 }),
        );
      }
      listCalls += 1;
      return respond(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
    });
    await expect(http.request('/api/v1/lists')).rejects.toBeInstanceOf(ApiError);
    expect(listCalls).toBe(2);
    expect(store.cleared).toBe(true);
  });

  it('replay 403 does not clear', async () => {
    const store = memoryStore({ accessToken: 'expired', refreshToken: 'r1', expiresIn: 900 });
    const http = makeHttp('bearer', store, (url, init) => {
      if (urlOf(url).endsWith('/api/v1/auth/refresh')) {
        return respond(
          200,
          authResponse({ accessToken: 'new', refreshToken: 'r2', expiresIn: 900 }),
        );
      }
      if (authorizationOf(init) === 'Bearer expired') {
        return respond(401, { error: { code: 'INVALID_TOKEN', message: 'x' } });
      }
      return respond(403, { error: { code: 'NOT_FOUND', message: '资源不存在' } });
    });
    await expect(http.request('/api/v1/lists')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(store.cleared).toBe(false);
    expect(store.tokens?.accessToken).toBe('new');
  });

  it('skipAuthRefresh 401 does not refresh', async () => {
    const store = memoryStore({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    let refreshCount = 0;
    const http = makeHttp('cookie', store, (url) => {
      if (urlOf(url).endsWith('/api/v1/auth/refresh')) {
        refreshCount += 1;
        return respond(200, {});
      }
      return respond(401, { error: { code: 'INVALID_CREDENTIALS', message: '凭据错误' } });
    });
    await expect(
      http.request('/api/v1/auth/login', { method: 'POST', skipAuthRefresh: true }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(refreshCount).toBe(0);
  });

  it('business error details and 204 empty body', async () => {
    const store = memoryStore();
    let status = 403;
    const http = makeHttp('bearer', store, () => {
      if (status === 403) {
        status = 204;
        return respond(403, {
          error: { code: 'NOT_FOUND', message: '资源不存在', details: { id: 'x' } },
        });
      }
      return respond204();
    });
    await expect(http.request('/api/v1/uploads/x', { method: 'DELETE' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      details: { id: 'x' },
    });
    const none: unknown = await http.request('/api/v1/uploads/x', { method: 'DELETE' });
    expect(none).toBeUndefined();
  });

  it('network failure and non-JSON error body', async () => {
    const store = memoryStore();
    const failing = makeHttp('bearer', store, () => {
      throw new TypeError('fetch failed');
    });
    await expect(failing.request('/api/v1/lists')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });

    const html = makeHttp('bearer', store, () => {
      return Promise.resolve(
        new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
      );
    });
    await expect(html.request('/api/v1/lists')).rejects.toMatchObject({
      code: 'HTTP_502',
      status: 502,
    });
  });

  it('query skips undefined', async () => {
    const store = memoryStore();
    let seen = '';
    const http = makeHttp('bearer', store, (u) => {
      seen = urlOf(u);
      return respond(200, {});
    });
    await http.request('/api/v1/lists', { query: { cursor: undefined, limit: 7, smart: true } });
    expect(seen).toBe('http://x/api/v1/lists?limit=7&smart=true');
  });
});
