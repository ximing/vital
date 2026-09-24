import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { notificationChannels, notificationOutbox, tasks, users } from '../../src/db/schema.js';
import { renderMeowMessage, processDueNotifications } from '../../src/notifications/dispatch.js';
import {
  countEveningDigestTasks,
  enqueueEveningDigests,
  eveningDigestMessage,
  eveningDigestWhen,
} from '../../src/notifications/evening-digest.js';
import { syncTaskNotifications } from '../../src/notifications/outbox.js';
import { setMeowTransport } from '../../src/notifications/meow.js';
import { getUserEntity } from '../../src/auth/auth.service.js';
import { resetDb } from '../helpers/db.js';
import { inboxId, registerUser } from '../helpers/session.js';

const TZ = 'Asia/Shanghai';
const afternoon = DateTime.fromISO('2026-09-24T16:00:00', { zone: TZ }).toJSDate();
const evening = DateTime.fromISO('2026-09-24T21:00:00', { zone: TZ }).toJSDate();
const dueToday = DateTime.fromISO('2026-09-24', { zone: TZ }).startOf('day').toJSDate();

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  setMeowTransport(null);
});

afterAll(async () => {
  await app.close();
});

describe('eveningDigestWhen', () => {
  it('waits until 21:00, then uses now once that clock has passed', () => {
    const early = eveningDigestWhen(
      DateTime.fromISO('2026-09-24T20:00:00', { zone: TZ }).toJSDate(),
      TZ,
    );
    if (!early) throw new Error('missing evening slot');
    expect(early.day).toBe('2026-09-24');
    expect(DateTime.fromJSDate(early.scheduledAt, { zone: TZ }).toFormat('HH:mm')).toBe('21:00');

    const late = eveningDigestWhen(
      DateTime.fromISO('2026-09-24T21:30:00', { zone: TZ }).toJSDate(),
      TZ,
    );
    expect(late?.scheduledAt.toISOString()).toBe('2026-09-24T13:30:00.000Z');
  });
});

describe('evening digest', () => {
  it('renders one count and skips an empty evening', async () => {
    expect(renderMeowMessage({
      title: '晚间提醒',
      listId: '',
      listName: '',
      dueAt: null,
      remindAt: null,
      isAllDay: false,
      timezone: TZ,
      eventType: 'task.digest',
      message: eveningDigestMessage(2),
    })).toEqual({ title: '晚间提醒', msg: '今天还有 2 件没处理' });

    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const user = await getUserEntity(alice.id);
    const morningTask = randomUUID();
    const lateTask = randomUUID();
    const doneTask = randomUUID();
    const habitTask = randomUUID();
    await getDb().insert(tasks).values([
      {
        id: morningTask,
        userId: alice.id,
        listId,
        title: '早上那件',
        timezone: TZ,
        status: 'todo',
        isAllDay: true,
        dueAt: dueToday,
        createdAt: DateTime.fromISO('2026-09-24T08:00:00', { zone: TZ }).toJSDate(),
        sortOrder: 1,
      },
      {
        id: lateTask,
        userId: alice.id,
        listId,
        title: '下午记下的',
        timezone: TZ,
        status: 'todo',
        isAllDay: true,
        dueAt: dueToday,
        createdAt: afternoon,
        sortOrder: 2,
      },
      {
        id: doneTask,
        userId: alice.id,
        listId,
        title: '已经完成',
        timezone: TZ,
        status: 'done',
        isAllDay: true,
        dueAt: dueToday,
        createdAt: afternoon,
        sortOrder: 3,
      },
      {
        id: habitTask,
        userId: alice.id,
        listId,
        title: '喝水',
        timezone: TZ,
        status: 'todo',
        isAllDay: true,
        dueAt: dueToday,
        habitId: randomUUID(),
        createdAt: afternoon,
        sortOrder: 4,
      },
    ]);

    const [late] = await getDb().select().from(tasks).where(eq(tasks.id, lateTask));
    if (!late) throw new Error('missing late task');
    await syncTaskNotifications(late, user, afternoon);
    const lateRows = await getDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.entityId, lateTask));
    expect(lateRows).toHaveLength(0);

    expect(await countEveningDigestTasks(alice.id, TZ, afternoon)).toBe(2);
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    expect(await enqueueEveningDigests(afternoon)).toBe(0);
    const pending = await getDb().select().from(notificationOutbox);
    expect(pending).toHaveLength(1);
    const slot = pending[0];
    if (!slot) throw new Error('missing digest');
    expect(slot.eventType).toBe('task.digest');
    expect(DateTime.fromJSDate(slot.scheduledAt, { zone: TZ }).toFormat('HH:mm')).toBe('21:00');

    const postJson = vi.fn((_url: string, _body: Record<string, unknown>) =>
      Promise.resolve({ httpStatus: 200, json: { status: 200, message: 'ok' } }),
    );
    setMeowTransport({ postJson });
    await getDb().insert(notificationChannels).values({
      id: randomUUID(),
      userId: alice.id,
      type: 'meow',
      enabled: true,
      config: { nickname: 'Ada' },
      createdAt: afternoon,
      updatedAt: afternoon,
    });

    expect(await processDueNotifications(evening)).toBe(1);
    expect(postJson).toHaveBeenCalledTimes(1);
    expect(postJson.mock.calls[0]?.[1]).toMatchObject({
      title: '晚间提醒',
      msg: '今天还有 2 件没处理',
      url: 'http://localhost:5180/today',
    });
    const sent = await getDb().select().from(notificationOutbox);
    expect(sent[0]?.status).toBe('sent');
    expect(sent[0]?.payload.message).toBe('今天还有 2 件没处理');

    expect(await enqueueEveningDigests(evening)).toBe(0);
    expect(await processDueNotifications(evening)).toBe(0);
  });

  it('cancels the digest when nothing is still open', async () => {
    await registerUser(app);
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    expect(await processDueNotifications(evening)).toBe(1);
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.status).toBe('cancelled');
    expect(row?.lastError).toBe('nothing open');
  });

  it('drops the digest when quiet hours run through midnight', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await getDb().insert(tasks).values({
      id: randomUUID(),
      userId: alice.id,
      listId,
      title: '还在',
      timezone: TZ,
      status: 'todo',
      isAllDay: true,
      dueAt: dueToday,
      createdAt: afternoon,
      sortOrder: 1,
    });
    await getDb()
      .update(users)
      .set({ quietHoursStart: '20:00', quietHoursEnd: '08:00' })
      .where(eq(users.id, alice.id));
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    const postJson = vi.fn((_url: string, _body: Record<string, unknown>) =>
      Promise.resolve({ httpStatus: 200, json: { status: 200, message: 'ok' } }),
    );
    setMeowTransport({ postJson });
    expect(await processDueNotifications(evening)).toBe(1);
    expect(postJson).not.toHaveBeenCalled();
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.status).toBe('cancelled');
    expect(row?.lastError).toBe('quiet hours crossed midnight');
  });

  it('does not schedule a digest when due notifications are off', async () => {
    const alice = await registerUser(app);
    await getDb().update(users).set({ notifyTaskDue: false }).where(eq(users.id, alice.id));
    expect(await enqueueEveningDigests(afternoon)).toBe(0);
    expect(await getDb().select().from(notificationOutbox)).toHaveLength(0);
  });
});
