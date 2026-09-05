import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

afterAll(async () => {
  await app.close();
});

describe('health', () => {
  it('GET /api/health returns 200 {status:"ok"}', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/ready returns 200 after SELECT 1', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('unknown route returns envelope 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
    expect(res.json().error.message).toBe('资源不存在');
  });
});
