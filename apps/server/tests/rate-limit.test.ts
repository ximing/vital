import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { resetAuthRateLimits, setAuthRateLimits } from '../src/plugins/rate-limit.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  resetAuthRateLimits();
});

afterEach(() => {
  resetAuthRateLimits();
});

afterAll(async () => {
  await app.close();
});

describe('auth rate limits', () => {
  it('6th login in the window is 429 RATE_LIMITED', async () => {
    setAuthRateLimits({ login: 5 });
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'rate@example.com', password: 'secret123', displayName: 'Rate' },
    });

    for (let i = 0; i < 5; i++) {
      const res = await injectJson(app, {
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'rate@example.com', password: 'wrong-pass' },
      });
      expect(res.statusCode).toBe(401);
    }

    const limited = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: '  Rate@Example.com ', password: 'wrong-pass' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.json().error.message).toBe('请求过于频繁，请稍后再试');
  });
});
