import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REFRESH_COOKIE_NAME } from '../src/auth/cookies.js';
import { buildFastify } from '../src/app.js';
import { db } from '../src/db/index.js';
import { qrLoginTickets } from '../src/db/schema.js';
import { resetDb } from './helpers/db.js';
import { cookieFrom, injectJson, WEB_ORIGIN } from './helpers/http.js';

let app: FastifyInstance;

const alice = { email: 'Alice@Example.com', password: 'secret123', displayName: 'Alice' };

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

async function registerToken(): Promise<string> {
  const registered = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: alice,
  });
  expect(registered.statusCode).toBe(201);
  return registered.json().tokens.accessToken as string;
}

async function createTicket(): Promise<{ id: string; secret: string; expiresAt: string }> {
  const created = await injectJson(app, { method: 'POST', url: '/api/v1/auth/qr' });
  expect(created.statusCode).toBe(201);
  const body = created.json() as { id: string; secret: string; expiresAt: string };
  expect(body.secret).toMatch(/^[A-Za-z0-9_-]{20,128}$/);
  expect(created.json().secretHash).toBeUndefined();
  return body;
}

describe('qr login', () => {
  it('phone confirm issues a cookie session to the web poller once', async () => {
    const token = await registerToken();
    const ticket = await createTicket();

    const pending = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/poll',
      origin: WEB_ORIGIN,
      payload: ticket,
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toEqual({ status: 'pending' });

    const anonScan = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/scan',
      payload: ticket,
    });
    expect(anonScan.statusCode).toBe(401);

    const scanned = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/scan',
      token,
      payload: ticket,
    });
    expect(scanned.statusCode).toBe(200);
    expect(scanned.json()).toEqual({ status: 'scanned' });

    const waiting = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/poll',
      origin: WEB_ORIGIN,
      payload: ticket,
    });
    expect(waiting.json()).toEqual({ status: 'scanned' });

    const confirmed = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/confirm',
      token,
      payload: ticket,
    });
    expect(confirmed.json()).toEqual({ status: 'confirmed' });

    const loggedIn = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/poll',
      origin: WEB_ORIGIN,
      payload: ticket,
    });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.json().status).toBe('confirmed');
    expect(loggedIn.json().user.email).toBe('alice@example.com');
    expect(loggedIn.json().tokens.accessToken).toBeTruthy();
    expect(loggedIn.json().tokens.refreshToken).toBeUndefined();
    expect(cookieFrom(loggedIn, REFRESH_COOKIE_NAME)).toBeTruthy();

    const again = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/poll',
      origin: WEB_ORIGIN,
      payload: ticket,
    });
    expect(again.json()).toEqual({ status: 'expired' });
  });

  it('bearer poll returns a refresh token, and a bad secret is rejected', async () => {
    const token = await registerToken();
    const ticket = await createTicket();
    await injectJson(app, { method: 'POST', url: '/api/v1/auth/qr/scan', token, payload: ticket });
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/confirm',
      token,
      payload: ticket,
    });

    const loggedIn = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/poll',
      payload: ticket,
    });
    expect(loggedIn.json().tokens.refreshToken).toBeTruthy();
    expect(cookieFrom(loggedIn, REFRESH_COOKIE_NAME)).toBeUndefined();

    const wrong = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/poll',
      payload: { id: ticket.id, secret: 'b'.repeat(32) },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('QR_LOGIN_INVALID');
  });

  it('cancel stops the web login, and an expired ticket cannot be confirmed', async () => {
    const token = await registerToken();
    const ticket = await createTicket();
    await injectJson(app, { method: 'POST', url: '/api/v1/auth/qr/scan', token, payload: ticket });
    const cancelled = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/cancel',
      token,
      payload: ticket,
    });
    expect(cancelled.json()).toEqual({ status: 'cancelled' });

    const confirm = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/confirm',
      token,
      payload: ticket,
    });
    expect(confirm.statusCode).toBe(400);

    const poll = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/poll',
      payload: ticket,
    });
    expect(poll.json()).toEqual({ status: 'cancelled' });

    const next = await createTicket();
    await db
      .update(qrLoginTickets)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(qrLoginTickets.id, next.id));
    const stale = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/qr/scan',
      token,
      payload: next,
    });
    expect(stale.statusCode).toBe(400);
    expect(stale.json().error.code).toBe('QR_LOGIN_INVALID');
  });
});
