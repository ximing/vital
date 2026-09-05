import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { registerUser } from './helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

describe('tags', () => {
  it('second POST with the same lower(name) is 409', async () => {
    const alice = await registerUser(app);
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tags',
      token: alice.token,
      payload: { name: 'Work' },
    });
    expect(first.statusCode).toBe(201);
    const dup = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tags',
      token: alice.token,
      payload: { name: 'work' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('VALIDATION_ERROR');
  });
});
