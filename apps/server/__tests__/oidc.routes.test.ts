import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetOidcCaches } from '../src/auth/oidc.service.js';
import { buildFastify } from '../src/app.js';
import { config } from '../src/config.js';
import { getDb } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { resetDb } from './helpers/db.js';
import { injectJson, WEB_ORIGIN } from './helpers/http.js';

let app: FastifyInstance;

const saved = {
  OIDC_ISSUER: config.OIDC_ISSUER,
  OIDC_CLIENT_ID: config.OIDC_CLIENT_ID,
  OIDC_CLIENT_SECRET: config.OIDC_CLIENT_SECRET,
  OIDC_REDIRECT_URI: config.OIDC_REDIRECT_URI,
  OIDC_AUDIENCE: config.OIDC_AUDIENCE,
  OIDC_SCOPES: config.OIDC_SCOPES,
  OIDC_ADMIN_USER: config.OIDC_ADMIN_USER,
  OIDC_ADMIN_PASSWORD: config.OIDC_ADMIN_PASSWORD,
};

const issuer = 'https://super-agent-auth.aimo.plus/realms/aimo-plus-prod';

function enableOidc(): void {
  config.OIDC_ISSUER = issuer;
  config.OIDC_CLIENT_ID = 'vital';
  config.OIDC_CLIENT_SECRET = '0123456789abcdef';
  config.OIDC_REDIRECT_URI = `${WEB_ORIGIN}/api/auth/oidc/callback`;
  config.OIDC_AUDIENCE = 'vital-api';
  config.OIDC_SCOPES = undefined;
  config.OIDC_ADMIN_USER = undefined;
  config.OIDC_ADMIN_PASSWORD = undefined;
}

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  Object.assign(config, saved);
  resetOidcCaches();
  vi.unstubAllGlobals();
});

afterEach(() => {
  Object.assign(config, saved);
  resetOidcCaches();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await app.close();
});

describe('oidc routes', () => {
  it('reports disabled and sends start back to login without calling Keycloak', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const status = await app.inject({ method: 'GET', url: '/api/auth/oidc/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ enabled: false });

    const start = await app.inject({ method: 'GET', url: '/api/auth/oidc/start' });
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toBe(`${WEB_ORIGIN}/login`);
    expect(String(start.headers.location)).not.toContain('oidc_error');
    expect(String(start.headers.location)).not.toContain('client_secret');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('starts at the realm authorize endpoint without the client secret', async () => {
    enableOidc();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Response.json({
          issuer,
          authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
          token_endpoint: `${issuer}/protocol/openid-connect/token`,
          jwks_uri: `${issuer}/protocol/openid-connect/certs`,
        }),
      ),
    );
    const start = await app.inject({ method: 'GET', url: '/api/auth/oidc/start?return=/today' });
    expect(start.statusCode).toBe(302);
    const location = String(start.headers.location);
    expect(location.startsWith(`${issuer}/protocol/openid-connect/auth`)).toBe(true);
    expect(location).toContain('client_id=vital');
    expect(location).toContain('code_challenge=');
    expect(location).not.toContain('client_secret');
  });

  it('sends a callback without the transaction cookie back to login', async () => {
    enableOidc();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const callback = await app.inject({ method: 'GET', url: '/api/auth/oidc/callback' });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`${WEB_ORIGIN}/login?oidc_error=OIDC_STATE`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a null password hash before verifying it', async () => {
    const registered = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'ada@example.com', password: 'secret123', displayName: 'Ada' },
    });
    expect(registered.statusCode).toBe(201);
    const token = registered.json().tokens.accessToken as string;
    await getDb().update(users).set({ passwordHash: null }).where(eq(users.email, 'ada@example.com'));

    const login = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ada@example.com', password: 'secret123' },
    });
    expect(login.statusCode).toBe(401);
    expect(login.json().error.code).toBe('INVALID_CREDENTIALS');

    const changed = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/change-password',
      token,
      payload: { oldPassword: 'secret123', newPassword: 'another123' },
    });
    expect(changed.statusCode).toBe(400);
    expect(changed.json().error).toMatchObject({
      code: 'PASSWORD_NOT_SET',
      message: '此账号没有本地密码',
    });
  });

  it('rejects registration when the realm already has the email and creates no local user', async () => {
    enableOidc();
    config.OIDC_ADMIN_USER = 'oidc-admin';
    config.OIDC_ADMIN_PASSWORD = 'oidc-admin-password';
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/protocol/openid-connect/token')) {
          return Response.json({ access_token: 'admin-token', expires_in: 60 });
        }
        if (url.includes('/users?')) {
          return Response.json([{ id: '11111111-1111-4111-8111-111111111111' }]);
        }
        return new Response('', { status: 500 });
      }),
    );
    const registered = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'ada@example.com', password: 'secret123', displayName: 'Ada' },
    });
    expect(registered.statusCode).toBe(409);
    expect(registered.json().error).toMatchObject({
      code: 'OIDC_EMAIL_EXISTS',
      message: '该邮箱已存在，请使用统一账号登录',
    });
    const rows = await getDb().select({ id: users.id }).from(users);
    expect(rows).toHaveLength(0);
  });
});
