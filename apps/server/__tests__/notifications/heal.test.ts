import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { notificationOutbox, tasks } from '../../src/db/schema.js';
import {
  healTaskNotifications,
  resetHealTaskNotificationsCursor,
} from '../../src/notifications/dispatch.js';
import { resetDb } from '../helpers/db.js';
import { inboxId, registerUser } from '../helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  resetHealTaskNotificationsCursor();
});

afterAll(async () => {
  await app.close();
});

async function insertOpenTask(
  userId: string,
  listId: string,
  id: `${string}-${string}-${string}-${string}-${string}` = randomUUID(),
): Promise<string> {
  await getDb()
    .insert(tasks)
    .values({
      id,
      userId,
      listId,
      title: `heal-${id.slice(0, 8)}`,
      timezone: 'Asia/Shanghai',
      status: 'todo',
      dueAt: new Date(Date.now() + 60 * 60_000),
      sortOrder: 0,
    });
  return id;
}

async function outboxTaskIds(): Promise<string[]> {
  const rows = await getDb().select({ entityId: notificationOutbox.entityId }).from(notificationOutbox);
  return [...new Set(rows.map((row) => row.entityId))].sort();
}

describe('healTaskNotifications keyset scan', () => {
  it('advances a cursor, caps each tick, and wraps after a full pass', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000004',
      '00000000-0000-4000-8000-000000000005',
    ] as const;
    for (const id of ids) await insertOpenTask(alice.id, listId, id);

    expect(await healTaskNotifications(new Date(), 2)).toBe(2);
    expect(await outboxTaskIds()).toEqual([ids[0], ids[1]].sort());

    expect(await healTaskNotifications(new Date(), 2)).toBe(2);
    expect(await outboxTaskIds()).toHaveLength(4);

    expect(await healTaskNotifications(new Date(), 2)).toBe(1);
    expect(await outboxTaskIds()).toHaveLength(5);

    const wrapped = await healTaskNotifications(new Date(), 2);
    expect(wrapped).toBe(2);
    expect(await outboxTaskIds()).toHaveLength(5);
  });

  it('loads users for a page with a single IN query and skips ineligible rows', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app, 'bob');
    const aliceInbox = await inboxId(app, alice.token);
    const bobInbox = await inboxId(app, bob.token);
    const due = await insertOpenTask(alice.id, aliceInbox);
    const other = await insertOpenTask(bob.id, bobInbox);
    await getDb()
      .insert(tasks)
      .values({
        id: randomUUID(),
        userId: alice.id,
        listId: aliceInbox,
        title: 'done — skip',
        timezone: 'Asia/Shanghai',
        status: 'done',
        dueAt: new Date(),
      });
    await getDb()
      .insert(tasks)
      .values({
        id: randomUUID(),
        userId: alice.id,
        listId: aliceInbox,
        title: 'no remind',
        timezone: 'Asia/Shanghai',
        status: 'todo',
      });

    const n = await healTaskNotifications(new Date(), 50);
    expect(n).toBe(2);
    const healed = await outboxTaskIds();
    expect(healed).toEqual([due, other].sort());
  });
});
