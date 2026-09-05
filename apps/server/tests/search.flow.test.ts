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

  it('limit 1 second page follows ts_rank order, not updated_at slice', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    // Older exact token → higher ts_rank. Newer ILIKE-only hit (`applex`) → rank 0, later updated_at.
    const high = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'apple', listId: inbox },
    });
    expect(high.statusCode).toBe(201);
    const low = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'applex', listId: inbox },
    });
    expect(low.statusCode).toBe(201);

    const full = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/search',
      token: alice.token,
      payload: { q: 'apple', types: ['task'], limit: 50 },
    });
    expect(full.statusCode).toBe(200);
    const fullIds = (full.json().items as { task: { id: string; title: string } }[]).map(
      (h) => h.task.id,
    );
    expect(fullIds).toEqual([high.json().id, low.json().id]);

    const page1 = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/search',
      token: alice.token,
      payload: { q: 'apple', types: ['task'], limit: 1 },
    });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().items).toHaveLength(1);
    expect(page1.json().items[0].task.id).toBe(fullIds[0]);
    expect(page1.json().nextCursor).toBeTruthy();

    const page2 = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/search',
      token: alice.token,
      payload: { q: 'apple', types: ['task'], limit: 1, cursor: page1.json().nextCursor },
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().items).toHaveLength(1);
    expect(page2.json().items[0].task.id).toBe(fullIds[1]);
  });
});
