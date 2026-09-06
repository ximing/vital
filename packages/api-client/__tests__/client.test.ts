import { DEFAULT_NOTIFICATION_PREFS, type UserProfile } from '@vital/dto';
import { describe, expect, it } from 'vitest';
import { createVitalClient } from '../src/client.js';
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
  notifications: DEFAULT_NOTIFICATION_PREFS,
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
    await client.listNotificationChannels();
    await client.createNotificationChannel({ type: 'meow', config: { nickname: 'Ada' } });
    await client.updateOnboarding({ createdTask: true });
    await client.presignUpload({ mime: 'image/jpeg', size: 12 });
    await client.completeUpload('att1');
    await client.abortUpload('att1');
    await client.discardUpload('att1');
    expect(client.uploadUrl('att1')).toBe('http://x/api/v1/uploads/att1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://x/api/v1/auth/me',
      'PATCH http://x/api/v1/auth/me',
      'GET http://x/api/v1/notification-channels',
      'POST http://x/api/v1/notification-channels',
      'PATCH http://x/api/v1/auth/onboarding',
      'POST http://x/api/v1/uploads/presign',
      'POST http://x/api/v1/uploads/att1/complete',
      'POST http://x/api/v1/uploads/att1/abort',
      'DELETE http://x/api/v1/uploads/att1',
    ]);
    expect(calls[3]?.body).toEqual({ type: 'meow', config: { nickname: 'Ada' } });
    expect(calls[5]?.body).toEqual({ mime: 'image/jpeg', size: 12 });
    expect(calls[6]?.body).toEqual({});
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

  it('inbox extract/create/assets/convert methods hit the spec routes', async () => {
    const store = memoryStore({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 });
    const calls: { method: string; url: string; body: unknown; idem?: string }[] = [];
    const client = createVitalClient({
      baseUrl: 'http://x',
      authMode: 'bearer',
      tokenStore: store,
      fetchImpl: (url, init) => {
        const u = urlOf(url);
        const headers = init?.headers;
        let idem: string | undefined;
        if (headers instanceof Headers) {
          const value = headers.get('Idempotency-Key');
          idem = value === null ? undefined : value;
        } else if (headers && !Array.isArray(headers)) {
          idem = headers['Idempotency-Key'];
        }
        const rec: { method: string; url: string; body: unknown; idem?: string } = {
          method: init?.method ?? 'GET',
          url: u,
          body: bodyOf(init),
        };
        if (idem !== undefined) rec.idem = idem;
        calls.push(rec);
        if (init?.method === 'DELETE') return respond204();
        return respond(200, { id: 'i1' });
      },
    });
    await client.extractInbox({ url: 'https://example.com/a' });
    await client.createInbox(
      { title: 'A', originalUrl: 'https://example.com/a', source: 'extension' },
      'a'.repeat(64),
    );
    await client.patchInboxAssets('i1', {
      assets: [
        {
          attachmentId: '11111111-1111-4111-8111-111111111111',
          originalSrc: 'https://example.com/x.png',
          sortOrder: 0,
        },
      ],
    });
    await client.convertInbox('i1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST http://x/api/v1/inbox/extract',
      'POST http://x/api/v1/inbox',
      'PATCH http://x/api/v1/inbox/i1/assets',
      'POST http://x/api/v1/inbox/i1/convert',
    ]);
    expect(calls[1]?.idem).toBe('a'.repeat(64));
  });
});

describe('createVitalClient reports + sync', () => {
  it('hits current, embeds, fill, and sync/head', async () => {
    const store = memoryStore();
    const urls: string[] = [];
    const client = createVitalClient({
      baseUrl: 'http://x',
      authMode: 'bearer',
      tokenStore: store,
      fetchImpl: (url, init) => {
        urls.push(`${init?.method ?? 'GET'} ${urlOf(url)}`);
        return respond(200, { id: 'r1', revision: 1, embeds: { tasks: {}, inbox: {} } });
      },
    });
    await client.getCurrentReport('daily');
    await client.getReportOverview('daily');
    await client.getReportReview('r1');
    await client.getReportEmbeds('r1');
    await client.fillReport('r1', { revision: 1 });
    await client.syncHead();
    expect(urls).toEqual([
      'GET http://x/api/v1/reports/current?type=daily',
      'GET http://x/api/v1/reports/overview?type=daily',
      'GET http://x/api/v1/reports/r1/review',
      'GET http://x/api/v1/reports/r1/embeds',
      'POST http://x/api/v1/reports/r1/fill',
      'GET http://x/api/v1/sync/head',
    ]);
  });
});
