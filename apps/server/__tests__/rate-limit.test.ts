import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { buildFastify } from '../src/app.js';
import {
  authHitKeys,
  authHitsSize,
  limitLogin,
  resetAuthRateLimits,
  seedAuthRateHit,
  setAuthHitsMaxKeys,
  setAuthRateLimits,
  sweepExpiredAuthHits,
} from '../src/plugins/rate-limit.js';
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

  it('per-email login cap fires across IPs', async () => {
    setAuthRateLimits({ login: 2 });
    const email = 'spray@example.com';
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'wrong-pass' },
      remoteAddress: '203.0.113.1',
    });
    expect(first.statusCode).toBe(401);
    const second = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'wrong-pass' },
      remoteAddress: '203.0.113.2',
    });
    expect(second.statusCode).toBe(401);
    const third = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'wrong-pass' },
      remoteAddress: '203.0.113.3',
    });
    expect(third.statusCode).toBe(429);
    expect(third.json().error.code).toBe('RATE_LIMITED');
  });
});

describe('auth hits map', () => {
  beforeEach(() => {
    resetAuthRateLimits();
  });

  afterEach(() => {
    resetAuthRateLimits();
  });

  it('sweepExpiredAuthHits drops buckets whose resetAt has passed', () => {
    const now = 1_700_000_000_000;
    seedAuthRateHit('login:old', now - 1, 3);
    seedAuthRateHit('login:live', now + 60_000, 1);
    expect(sweepExpiredAuthHits(now)).toBe(1);
    expect(authHitKeys()).toEqual(['login:live']);
  });

  it('per-email login cap fires across IPs at the hit() layer', async () => {
    setAuthRateLimits({ login: 2 });
    const req = (ip: string, email: string) =>
      ({ ip, body: { email } }) as FastifyRequest;
    await limitLogin(req('203.0.113.1', 'spray@example.com'));
    await limitLogin(req('203.0.113.2', 'spray@example.com'));
    let thrown: unknown;
    try {
      await limitLogin(req('203.0.113.3', 'spray@example.com'));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).status).toBe(429);
    expect((thrown as AppError).code).toBe('RATE_LIMITED');
    await limitLogin(req('203.0.113.3', 'other@example.com'));
  });

  it('evicts the oldest resetAt bucket when over the hard cap', async () => {
    setAuthHitsMaxKeys(2);
    setAuthRateLimits({ login: 1000 });
    const now = Date.now();
    seedAuthRateHit('keep-later', now + 80_000, 1);
    seedAuthRateHit('evict-me', now + 10_000, 1);
    expect(authHitsSize()).toBe(2);

    await limitLogin({
      ip: '198.51.100.9',
      body: { email: 'new@example.com' },
    } as FastifyRequest);

    const keys = authHitKeys();
    expect(keys).not.toContain('evict-me');
    expect(keys).toContain('keep-later');
    expect(authHitsSize()).toBe(2);
  });
});
