import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
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

describe('search', () => {
  it('POST /search finds tasks by title including CJK', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '买牛奶', listId: inbox },
    });
    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/search',
      token: alice.token,
      payload: { q: '牛奶', types: ['task'] },
    });
    expect(res.statusCode).toBe(200);
    const titles = (res.json().items as { task: { title: string } }[]).map((h) => h.task.title);
    expect(titles).toContain('买牛奶');
  });
});
