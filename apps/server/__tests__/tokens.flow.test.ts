import { API_TOKEN_MAX_PER_USER, API_TOKEN_PREFIX } from '@vital/dto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { getDb } from '../src/db/index.js';
import { apiTokenAccessLogs } from '../src/db/schema.js';
import { purgeExpiredApiTokenAccess } from '../src/tokens/tokens.service.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { inboxId, registerUser } from './helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

describe('api tokens', () => {
  it('creates a vt_ secret once, authenticates with it, and records access', async () => {
    const session = await registerUser(app);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tokens',
      token: session.token,
      payload: { name: '  agent  ' },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.name).toBe('agent');
    expect(body.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(body.tokenHash).toBeUndefined();
    expect(body.tokenPrefix).toBe(body.token.slice(0, 12));

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/tokens',
      token: session.token,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(listed.json().items[0].token).toBeUndefined();

    const me = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/auth/me',
      token: body.token,
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(session.id);

    const listId = await inboxId(app, body.token);
    const task = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: body.token,
      payload: { title: 'PAT task', listId },
    });
    expect(task.statusCode).toBe(201);

    const access = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tokens/${body.id}/access`,
      token: session.token,
    });
    expect(access.statusCode).toBe(200);
    const paths = access.json().items.map((row: { path: string; method: string }) => {
      return `${row.method} ${row.path}`;
    });
    expect(paths).toContain('GET /api/v1/auth/me');
    expect(paths).toContain('POST /api/v1/tasks');
    expect(paths.some((p: string) => p.includes('?'))).toBe(false);

    const jwtMe = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/auth/me',
      token: session.token,
    });
    expect(jwtMe.statusCode).toBe(200);
    const afterJwt = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tokens/${body.id}/access`,
      token: session.token,
    });
    expect(afterJwt.json().items).toHaveLength(access.json().items.length);
  });

  it('revokes a token and rejects further calls', async () => {
    const session = await registerUser(app, 'bob');
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tokens',
      token: session.token,
      payload: { name: 'temp' },
    });
    const token = created.json().token as string;
    const id = created.json().id as string;

    const revoked = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/tokens/${id}`,
      token: session.token,
    });
    expect(revoked.statusCode).toBe(204);

    const me = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/auth/me',
      token,
    });
    expect(me.statusCode).toBe(401);

    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/tokens',
      token: session.token,
    });
    expect(listed.json().items).toHaveLength(0);
  });

  it('enforces the per-user cap and purges logs older than 30 days', async () => {
    const session = await registerUser(app, 'cap');
    for (let i = 0; i < API_TOKEN_MAX_PER_USER; i += 1) {
      const res = await injectJson(app, {
        method: 'POST',
        url: '/api/v1/tokens',
        token: session.token,
        payload: { name: `t${String(i)}` },
      });
      expect(res.statusCode).toBe(201);
    }
    const over = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tokens',
      token: session.token,
      payload: { name: 'overflow' },
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.code).toBe('TOKEN_LIMIT_REACHED');

    const first = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/tokens',
      token: session.token,
    });
    const tokenId = first.json().items[0].id as string;
    const old = new Date(Date.now() - 31 * 86_400_000);
    await getDb().insert(apiTokenAccessLogs).values({
      tokenId,
      userId: session.id,
      method: 'GET',
      path: '/api/v1/auth/me',
      status: 200,
      ip: '127.0.0.1',
      userAgent: 'test',
      createdAt: old,
    });
    const purged = await purgeExpiredApiTokenAccess();
    expect(purged).toBeGreaterThanOrEqual(1);
    const access = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tokens/${tokenId}/access`,
      token: session.token,
    });
    expect(access.json().items).toHaveLength(0);
  });
});
