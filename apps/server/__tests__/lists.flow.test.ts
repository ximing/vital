import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { db } from '../src/db/index.js';
import { lists, users } from '../src/db/schema.js';
import { backfillInboxLists, INBOX_LIST_NAME } from '../src/lists/lists.service.js';
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

describe('lists', () => {
  it('register creates 收集箱 (kind=inbox) in the same transaction', async () => {
    const alice = await registerUser(app);
    const res = await injectJson(app, { method: 'GET', url: '/api/v1/lists', token: alice.token });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { id: string; kind: string; name: string }[];
    const inbox = items.filter((l) => l.kind === 'inbox');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.name).toBe(INBOX_LIST_NAME);
    const smart = items.map((l) => l.id);
    expect(smart).toEqual(expect.arrayContaining([
      'smart:inbox',
      'smart:today',
      'smart:upcoming',
      'smart:someday',
      'smart:done',
    ]));
    expect(smart).not.toContain('smart:anytime');
  });

  it('backfill inserts 收集箱 for existing users', async () => {
    const [user] = await db
      .insert(users)
      .values({
        id: '11111111-1111-4111-8111-111111111111',
        email: 'legacy@test.com',
        passwordHash: 'x'.repeat(60),
        displayName: 'Legacy',
        timezone: 'Asia/Shanghai',
        locale: 'zh-CN',
        themePreference: 'system',
        weekStartsOn: 1,
        convertArchiveOnComplete: false,
        onboarding: {},
      })
      .returning();
    if (!user) throw new Error('insert user failed');
    const before = await db.select().from(lists).where(eq(lists.userId, user.id));
    expect(before).toHaveLength(0);
    const n = await backfillInboxLists();
    expect(n).toBeGreaterThanOrEqual(1);
    const after = await db
      .select()
      .from(lists)
      .where(eq(lists.userId, user.id));
    expect(after.some((l) => l.kind === 'inbox' && l.name === INBOX_LIST_NAME)).toBe(true);
  });

  it('cannot delete 收集箱; deleting a user list moves tasks there', async () => {
    const alice = await registerUser(app);
    const inbox = await inboxId(app, alice.token);
    const delInbox = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/lists/${inbox}`,
      token: alice.token,
    });
    expect(delInbox.statusCode).toBe(400);

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/lists',
      token: alice.token,
      payload: { name: 'Work' },
    });
    expect(created.statusCode).toBe(201);
    const listId = created.json().id as string;
    const task = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'Move me', listId },
    });
    expect(task.statusCode).toBe(201);
    const gone = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/lists/${listId}`,
      token: alice.token,
    });
    expect(gone.statusCode).toBe(204);
    const moved = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks/${task.json().id}`,
      token: alice.token,
    });
    expect(moved.json().listId).toBe(inbox);
  });

  it('mutations on smart:* are 400', async () => {
    const alice = await registerUser(app);
    const res = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/lists/smart:today',
      token: alice.token,
      payload: { name: 'nope' },
    });
    expect(res.statusCode).toBe(400);
  });
});
