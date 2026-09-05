import type { UserProfile } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import { createVitalClient } from './client.js';
import { bodyOf, memoryStore, respond, respond204, urlOf } from './test-helpers.js';

const user: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: 'A',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  convertArchiveOnComplete: true,
  onboarding: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('createVitalClient auth + upload methods', () => {
  it('cookie register/login persist access; logout POSTs {} with credentials', async () => {
    const store = memoryStore();
    const calls: {
      method: string;
      url: string;
      body: unknown;
      credentials: RequestCredentials | undefined;
    }[] = [];
    const client = createVitalClient({
      baseUrl: 'http://x',
      authMode: 'cookie',
      tokenStore: store,
      fetchImpl: (url, init) => {
        const u = urlOf(url);
        calls.push({
          method: init?.method ?? 'GET',
          url: u,
          body: bodyOf(init),
          credentials: init?.credentials,
        });
        if (u.endsWith('/register') || u.endsWith('/login')) {
          return respond(u.endsWith('/register') ? 201 : 200, {
            user,
            tokens: { accessToken: 'a1', expiresIn: 900 },
          });
        }
        return respond204();
      },
    });
    expect(client.authMode).toBe('cookie');
    await client.register({ email: 'a@b.c', password: 'secret123', displayName: 'A' });
    expect(store.tokens?.accessToken).toBe('a1');
    expect(store.tokens?.refreshToken).toBeUndefined();
    await client.login({ email: 'a@b.c', password: 'secret123' });
    await client.logout();
    expect(store.cleared).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST http://x/api/v1/auth/register',
      'POST http://x/api/v1/auth/login',
      'POST http://x/api/v1/auth/logout',
    ]);
    expect(calls[0]?.credentials).toBe('include');
    expect(calls[2]?.body).toEqual({});
  });

  it('cookie login does not persist a leaked refreshToken string', async () => {
    const store = memoryStore();
    const client = createVitalClient({
      baseUrl: 'http://x',
      authMode: 'cookie',
      tokenStore: store,
      fetchImpl: () =>
        respond(200, {
          user,
          tokens: { accessToken: 'a1', refreshToken: 'leak', expiresIn: 900 },
        }),
    });
    const res = await client.login({ email: 'a@b.c', password: 'secret123' });
    expect(store.tokens).toEqual({ accessToken: 'a1', expiresIn: 900 });
    expect(store.tokens?.refreshToken).toBeUndefined();
    expect(res.tokens.refreshToken).toBeUndefined();
  });

  it('bearer logout sends refreshToken JSON; changePassword clears', async () => {
    const store = memoryStore({ accessToken: 'a', refreshToken: 'r1', expiresIn: 900 });
    const calls: { url: string; body: unknown; credentials: RequestCredentials | undefined }[] = [];
    const client = createVitalClient({
      baseUrl: '',
      authMode: 'bearer',
      tokenStore: store,
      fetchImpl: (url, init) => {
        calls.push({ url: urlOf(url), body: bodyOf(init), credentials: init?.credentials });
        return respond204();
      },
    });
    await client.changePassword({ oldPassword: 'old-secret', newPassword: 'new-secret' });
    expect(store.cleared).toBe(true);
    await store.setTokens({ accessToken: 'a', refreshToken: 'r1', expiresIn: 900 });
    await client.logout();
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v1/auth/change-password',
      '/api/v1/auth/logout',
    ]);
    expect(calls[0]?.credentials).toBe('omit');
    expect(calls[1]?.body).toEqual({ refreshToken: 'r1' });
  });

  it('me / updateMe / onboarding / upload routes', async () => {
    const store = memoryStore({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    const calls: { method: string; url: string; body: unknown }[] = [];
    const client = createVitalClient({
      baseUrl: 'http://x',
      authMode: 'bearer',
      tokenStore: store,
      fetchImpl: (url, init) => {
        const u = urlOf(url);
        calls.push({ method: init?.method ?? 'GET', url: u, body: bodyOf(init) });
        if (u.includes('/uploads/') && (init?.method === 'DELETE' || u.endsWith('/abort'))) {
          return respond204();
        }
        return respond(200, { id: 'att1', status: 'ready' });
      },
    });
    await client.me();
    await client.updateMe({ displayName: 'Ada' });
    await client.updateOnboarding({ createdTask: true });
    await client.presignUpload({ mime: 'image/jpeg', size: 12 });
    await client.completeUpload('att1');
    await client.abortUpload('att1');
    await client.discardUpload('att1');
    expect(client.uploadUrl('att1')).toBe('http://x/api/v1/uploads/att1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://x/api/v1/auth/me',
      'PATCH http://x/api/v1/auth/me',
      'PATCH http://x/api/v1/auth/onboarding',
      'POST http://x/api/v1/uploads/presign',
      'POST http://x/api/v1/uploads/att1/complete',
      'POST http://x/api/v1/uploads/att1/abort',
      'DELETE http://x/api/v1/uploads/att1',
    ]);
    expect(calls[3]?.body).toEqual({ mime: 'image/jpeg', size: 12 });
    expect(calls[4]?.body).toEqual({});
  });

  it('lists/tasks/tags/search/bind methods hit the spec routes', async () => {
    const store = memoryStore({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    const calls: { method: string; url: string; body: unknown }[] = [];
    const client = createVitalClient({
      baseUrl: 'http://x',
      authMode: 'bearer',
      tokenStore: store,
      fetchImpl: (url, init) => {
        const u = urlOf(url);
        calls.push({ method: init?.method ?? 'GET', url: u, body: bodyOf(init) });
        if (init?.method === 'DELETE' || u.endsWith('/reorder')) return respond204();
        return respond(200, { items: [] });
      },
    });
    await client.listLists();
    await client.listTasks({ listId: 'smart:today' });
    await client.completeTask('t1');
    await client.uncompleteTask('t1', { completionId: 'c1' });
    await client.search({ q: '牛奶' });
    await client.bindUpload('att1', { ownerType: 'task', ownerId: 't1' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://x/api/v1/lists',
      'GET http://x/api/v1/tasks?listId=smart%3Atoday',
      'POST http://x/api/v1/tasks/t1/complete',
      'POST http://x/api/v1/tasks/t1/uncomplete',
      'POST http://x/api/v1/search',
      'POST http://x/api/v1/uploads/att1/bind',
    ]);
    expect(calls[3]?.body).toEqual({ completionId: 'c1' });
    expect(calls[5]?.body).toEqual({ ownerType: 'task', ownerId: 't1' });
  });
});
