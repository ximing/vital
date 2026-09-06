import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { SAMPLE_TAG, SAMPLE_TITLES, seedSampleTasks } from '../src/seed/sample.js';
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

describe('sample seed', () => {
  it('creates three inbox tasks tagged sample and is idempotent', async () => {
    const alice = await registerUser(app);
    const first = await seedSampleTasks(alice.id);
    expect(first.created).toBe(3);

    const tags = await injectJson(app, { method: 'GET', url: '/api/v1/tags', token: alice.token });
    expect(tags.statusCode).toBe(200);
    const sample = (tags.json().items as { id: string; name: string }[]).find(
      (tag) => tag.name === SAMPLE_TAG,
    );
    expect(sample?.id).toBeTruthy();
    const tagId = sample?.id ?? '';

    const inbox = await inboxId(app, alice.token);
    const listed = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks?listId=${inbox}`,
      token: alice.token,
    });
    expect(listed.statusCode).toBe(200);
    const items = listed.json().items as { title: string; tagIds: string[] }[];
    const seeded = items.filter((task) => task.tagIds.includes(tagId));
    expect(seeded.map((task) => task.title)).toEqual([...SAMPLE_TITLES]);

    const second = await seedSampleTasks(alice.id);
    expect(second.created).toBe(0);
  });
});
