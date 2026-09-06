import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { resetDb } from './helpers/db.js';
import {
  cookieCleared,
  cookieFrom,
  injectJson,
  requireCookie,
  WEB_ORIGIN,
} from './helpers/http.js';

let app: FastifyInstance;

const alice = { email: 'Alice@Example.com', password: 'secret123', displayName: 'Alice' };

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

describe('auth flow', () => {
  it('register normalizes email and returns tokens (bearer when Origin missing)', async () => {
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: alice,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe('alice@example.com');
    expect(body.user.displayName).toBe('Alice');
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.tokens.accessToken).toBeTruthy();
    expect(body.tokens.refreshToken).toBeTruthy();
    expect(body.tokens.expiresIn).toBe(900);
    expect(cookieFrom(res, REFRESH_COOKIE_NAME)).toBeUndefined();
  });

  it('login cookie vs bearer depends on Origin', async () => {
    await injectJson(app, { method: 'POST', url: '/api/v1/auth/register', payload: alice });

    const cookieLogin = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      origin: WEB_ORIGIN,
      payload: { email: alice.email, password: alice.password },
    });
    expect(cookieLogin.statusCode).toBe(200);
    const cookieBody = cookieLogin.json();
    expect(cookieBody.tokens.accessToken).toBeTruthy();
    expect(cookieBody.tokens.refreshToken).toBeUndefined();
    const cookie = cookieFrom(cookieLogin, REFRESH_COOKIE_NAME);
    expect(cookie).toBeTruthy();
    expect(cookieLogin.headers['set-cookie']?.toString()).toMatch(/HttpOnly/i);
    expect(cookieLogin.headers['set-cookie']?.toString()).toMatch(/Path=\/api\/v1\/auth/i);
    expect(cookieLogin.headers['set-cookie']?.toString()).toMatch(/SameSite=Lax/i);

    const bearerLogin = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: alice.email, password: alice.password },
    });
    expect(bearerLogin.statusCode).toBe(200);
    const bearerBody = bearerLogin.json();
    expect(bearerBody.tokens.refreshToken).toBeTruthy();
    expect(cookieFrom(bearerLogin, REFRESH_COOKIE_NAME)).toBeUndefined();
  });

  it('refresh rotates; reuse revokes all and clears cookie', async () => {
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      origin: WEB_ORIGIN,
      payload: alice,
    });
    expect(first.statusCode).toBe(201);
    const oldCookie = requireCookie(first, REFRESH_COOKIE_NAME);

    const rotated = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      origin: WEB_ORIGIN,
      cookie: oldCookie,
      payload: {},
    });
    expect(rotated.statusCode).toBe(200);
    const newCookie = requireCookie(rotated, REFRESH_COOKIE_NAME);
    expect(newCookie).not.toBe(oldCookie);
    expect(rotated.json().tokens.accessToken).toBeTruthy();
    expect(rotated.json().tokens.refreshToken).toBeUndefined();

    const reuse = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      origin: WEB_ORIGIN,
      cookie: oldCookie,
      payload: {},
    });
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error.code).toBe('INVALID_TOKEN');
    expect(cookieCleared(reuse, REFRESH_COOKIE_NAME)).toBe(true);

    const afterReuse = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      origin: WEB_ORIGIN,
      cookie: newCookie,
      payload: {},
    });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('bearer refresh rotates and reuse revokes', async () => {
    const reg = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: alice,
    });
    const refreshToken = reg.json().tokens.refreshToken;

    const rotated = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(rotated.statusCode).toBe(200);
    const next = rotated.json().tokens.refreshToken;
    expect(next).not.toBe(refreshToken);

    const reuse = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(reuse.statusCode).toBe(401);

    const after = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: next },
    });
    expect(after.statusCode).toBe(401);
  });

  it('change-password: invalid old is 400 not 401; success clears cookie and logs out', async () => {
    const reg = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      origin: WEB_ORIGIN,
      payload: alice,
    });
    const accessToken = reg.json().tokens.accessToken;

    const noAuth = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/change-password',
      payload: { oldPassword: alice.password, newPassword: 'new-secret-123' },
    });
    expect(noAuth.statusCode).toBe(401);

    const wrongOld = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/change-password',
      token: accessToken,
      payload: { oldPassword: 'wrong-old', newPassword: 'new-secret-123' },
    });
    expect(wrongOld.statusCode).toBe(400);
    expect(wrongOld.json().error.code).toBe('INVALID_OLD_PASSWORD');

    const ok = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/change-password',
      token: accessToken,
      origin: WEB_ORIGIN,
      payload: { oldPassword: alice.password, newPassword: 'new-secret-123' },
    });
    expect(ok.statusCode).toBe(204);
    expect(cookieCleared(ok, REFRESH_COOKIE_NAME)).toBe(true);

    const meAfter = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/auth/me',
      token: accessToken,
    });
    expect(meAfter.statusCode).toBe(401);

    const oldLogin = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: alice.email, password: alice.password },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: alice.email, password: 'new-secret-123' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('logout clears cookie and rejects the refresh token', async () => {
    const login = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      origin: WEB_ORIGIN,
      payload: alice,
    });
    const cookie = requireCookie(login, REFRESH_COOKIE_NAME);

    const out = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/logout',
      origin: WEB_ORIGIN,
      cookie,
      payload: {},
    });
    expect(out.statusCode).toBe(204);
    expect(cookieCleared(out, REFRESH_COOKIE_NAME)).toBe(true);

    const after = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      origin: WEB_ORIGIN,
      cookie,
      payload: {},
    });
    expect(after.statusCode).toBe(401);
  });

  it('duplicate email 409; bad login 401; validation 400; me requires token', async () => {
    await injectJson(app, { method: 'POST', url: '/api/v1/auth/register', payload: alice });
    const dup = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { ...alice, email: 'ALICE@example.com' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('EMAIL_ALREADY_REGISTERED');

    const bad = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: alice.email, password: 'wrong-pass' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('INVALID_CREDENTIALS');

    const invalid = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'bad', password: 'short', displayName: '' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('VALIDATION_ERROR');

    const me = await injectJson(app, { method: 'GET', url: '/api/v1/auth/me' });
    expect(me.statusCode).toBe(401);
  });

  it('PATCH /auth/onboarding merges flags and leaves omitted keys unchanged', async () => {
    const reg = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: alice,
    });
    const token = reg.json().tokens.accessToken;
    expect(reg.json().user.onboarding).toEqual({});

    const empty = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/onboarding',
      token,
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const first = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/onboarding',
      token,
      payload: { createdTask: true, completedTask: true },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().onboarding).toEqual({ createdTask: true, completedTask: true });

    const second = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/onboarding',
      token,
      payload: { capturedInbox: true, openedWeekly: true, pinnedTask: true },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().onboarding).toEqual({
      createdTask: true,
      completedTask: true,
      capturedInbox: true,
      openedWeekly: true,
      pinnedTask: true,
    });

    const skip = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/onboarding',
      token,
      payload: { dismissed: true },
    });
    expect(skip.statusCode).toBe(200);
    expect(skip.json().onboarding.dismissed).toBe(true);
    expect(skip.json().onboarding.createdTask).toBe(true);
  });
});
