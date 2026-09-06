import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildFastify } from '../src/app.js';
import { db } from '../src/db/index.js';
import { notificationOutbox } from '../src/db/schema.js';
import { processDueNotifications } from '../src/notifications/dispatch.js';
import { setMeowTransport } from '../src/notifications/meow.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { inboxId, registerUser } from './helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  setMeowTransport({
    postJson: () => Promise.resolve({ httpStatus: 200, json: { status: 200, message: '推送成功' } }),
  });
});

afterEach(() => {
  setMeowTransport(null);
});

afterAll(async () => {
  await app.close();
});

describe('notification channels and outbox', () => {
  it('creates a meow channel, rejects duplicates, and test-sends', async () => {
    const alice = await registerUser(app);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/notification-channels',
      token: alice.token,
      payload: { type: 'meow', config: { nickname: 'Ada' } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().config.nickname).toBe('Ada');

    const dup = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/notification-channels',
      token: alice.token,
      payload: { type: 'meow', config: { nickname: 'Bob' } },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CHANNEL_EXISTS');

    const test = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/notification-channels/${created.json().id}/test`,
      token: alice.token,
    });
    expect(test.statusCode).toBe(204);
  });

  it('writes outbox on create, worker delivers, complete cancels leftover pending', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/notification-channels',
      token: alice.token,
      payload: { type: 'meow', config: { nickname: 'Ada' } },
    });

    const dueAt = new Date(Date.now() + 60_000).toISOString();
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '买牛奶', listId, dueAt, isAllDay: false },
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().id as string;

    const pending = await db.select().from(notificationOutbox).where(eq(notificationOutbox.entityId, taskId));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.eventType).toBe('task.due');
    expect(pending[0]?.status).toBe('pending');

    await db
      .update(notificationOutbox)
      .set({ scheduledAt: new Date(Date.now() - 1000) })
      .where(eq(notificationOutbox.entityId, taskId));

    const n = await processDueNotifications(new Date());
    expect(n).toBe(1);
    const sent = await db.select().from(notificationOutbox).where(eq(notificationOutbox.entityId, taskId));
    expect(sent[0]?.status).toBe('sent');

    const later = new Date(Date.now() + 3600_000).toISOString();
    const second = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '还书', listId, dueAt: later, isAllDay: false },
    });
    const secondId = second.json().id as string;
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${secondId}/complete`,
      token: alice.token,
    });
    const after = await db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.entityId, secondId));
    expect(after[0]?.status).toBe('cancelled');
  });

  it('PATCH /auth/me stores notification prefs', async () => {
    const alice = await registerUser(app);
    const me = await injectJson(app, {
      method: 'PATCH',
      url: '/api/v1/auth/me',
      token: alice.token,
      payload: {
        notifications: {
          taskRemind: false,
          quietHoursStart: '23:00',
          quietHoursEnd: '08:00',
          allDayNotifyTime: '08:30',
        },
      },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().notifications).toMatchObject({
      taskRemind: false,
      taskDue: true,
      quietHoursStart: '23:00',
      quietHoursEnd: '08:00',
      allDayNotifyTime: '08:30',
    });
  });
});
