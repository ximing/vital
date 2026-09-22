import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { config } from '../src/config.js';
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

  it('extension one-time code exchanges for bearer tokens and cannot be reused', async () => {
    const registered = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: alice,
    });
    const token = registered.json().tokens.accessToken as string;
    const issued = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/extension/code',
      token,
    });
    expect(issued.statusCode).toBe(201);
    const code = issued.json().code as string;
    expect(code.length).toBeGreaterThanOrEqual(20);
    expect(issued.json().expiresIn).toBe(120);

    const exchanged = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/extension/exchange',
      payload: { code },
    });
    expect(exchanged.statusCode).toBe(200);
    expect(exchanged.json().user.email).toBe('alice@example.com');
    expect(exchanged.json().tokens.accessToken).toBeTruthy();
    expect(exchanged.json().tokens.refreshToken).toBeTruthy();

    const reuse = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/extension/exchange',
      payload: { code },
    });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json().error.code).toBe('AUTH_CODE_INVALID');
  });

  it('cookie refresh is reusable concurrently and does not rotate', async () => {
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      origin: WEB_ORIGIN,
      payload: alice,
    });
    expect(first.statusCode).toBe(201);
    const cookie = requireCookie(first, REFRESH_COOKIE_NAME);

    const [a, b] = await Promise.all([
      injectJson(app, {
        method: 'POST',
        url: '/api/v1/auth/refresh',
        origin: WEB_ORIGIN,
        cookie,
        payload: {},
      }),
      injectJson(app, {
        method: 'POST',
        url: '/api/v1/auth/refresh',
        origin: WEB_ORIGIN,
        cookie,
        payload: {},
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(requireCookie(a, REFRESH_COOKIE_NAME)).toBe(cookie);
    expect(requireCookie(b, REFRESH_COOKIE_NAME)).toBe(cookie);
    expect(a.json().tokens.refreshToken).toBeUndefined();
    expect(a.json().tokens.accessToken).toBeTruthy();
    expect(b.json().tokens.accessToken).toBeTruthy();

    const again = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      origin: WEB_ORIGIN,
      cookie,
      payload: {},
    });
    expect(again.statusCode).toBe(200);
  });

  it('bearer refresh is reusable and does not revoke other sessions', async () => {
    const cookieReg = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      origin: WEB_ORIGIN,
      payload: alice,
    });
    const cookie = requireCookie(cookieReg, REFRESH_COOKIE_NAME);

    const bearerLogin = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: alice.email, password: alice.password },
    });
    const refreshToken = bearerLogin.json().tokens.refreshToken as string;

    const [first, second] = await Promise.all([
      injectJson(app, { method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } }),
      injectJson(app, { method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } }),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().tokens.refreshToken).toBe(refreshToken);
    expect(second.json().tokens.refreshToken).toBe(refreshToken);

    const cookieRefresh = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      origin: WEB_ORIGIN,
      cookie,
      payload: {},
    });
    expect(cookieRefresh.statusCode).toBe(200);

    const out = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/logout',
      origin: WEB_ORIGIN,
      cookie,
      payload: {},
    });
    expect(out.statusCode).toBe(204);

    const cookieAfterLogout = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      origin: WEB_ORIGIN,
      cookie,
      payload: {},
    });
    expect(cookieAfterLogout.statusCode).toBe(401);
    expect(cookieCleared(cookieAfterLogout, REFRESH_COOKIE_NAME)).toBe(true);

    const bearerAfter = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(bearerAfter.statusCode).toBe(200);
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

  it('PATCH /auth/me stores the daily background model-call limit', async () => {
    const reg = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: alice,
    });
    const token = reg.json().tokens.accessToken;
    expect(reg.json().user.dailyModelCallLimit).toBe(config.AGENT_DAILY_MODEL_CALL_LIMIT);

    const invalid = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token,
      payload: { dailyModelCallLimit: 0 },
    });
    expect(invalid.statusCode).toBe(400);

    const updated = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token,
      payload: { dailyModelCallLimit: 250 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().dailyModelCallLimit).toBe(250);

    const me = await injectJson(app, { method: 'GET', url: '/api/v1/auth/me', token });
    expect(me.json().dailyModelCallLimit).toBe(250);
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
