import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { present } from '../helpers/present.js';
import { DateTime } from 'luxon';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import {
  agentModelBudgets,
  notificationChannels,
  notificationOutbox,
  outcomes,
  taskCompletions,
  tasks,
  users,
} from '../../src/db/schema.js';
import { reserveBackgroundModelCall } from '../../src/agent/model-budget.js';
import { renderMeowMessage, processDueNotifications } from '../../src/notifications/dispatch.js';
import {
  acceptEveningDigestText,
  countEveningDigestTasks,
  enqueueEveningDigests,
  eveningDigestKind,
  eveningDigestMessage,
  eveningDigestWhen,
  setEveningDigestRewrite,
  type EveningDigestFacts,
} from '../../src/notifications/evening-digest.js';
import { pushTargetOf } from '../../src/notifications/huawei-push.js';
import { syncTaskNotifications } from '../../src/notifications/outbox.js';
import { setMeowTransport } from '../../src/notifications/meow.js';
import { subscribe, unsubscribe, type SyncSocket } from '../../src/sync/sync.hub.js';
import { getUserEntity } from '../../src/auth/auth.service.js';
import { resetDb } from '../helpers/db.js';
import { inboxId, registerUser } from '../helpers/session.js';

const TZ = 'Asia/Shanghai';
const afternoon = DateTime.fromISO('2026-09-24T16:00:00', { zone: TZ }).toJSDate();
const evening = DateTime.fromISO('2026-09-24T21:00:00', { zone: TZ }).toJSDate();
const dueToday = DateTime.fromISO('2026-09-24', { zone: TZ }).startOf('day').toJSDate();
const dueTomorrow = DateTime.fromISO('2026-09-25', { zone: TZ }).startOf('day').toJSDate();

const leftoverFacts: EveningDigestFacts = {
  completed: 1,
  openToday: 1,
  outcomes: ['写作'],
  defer: { title: '周报', count: 4 },
  tomorrow: '写提纲',
};

const doneFacts: EveningDigestFacts = {
  completed: 2,
  openToday: 0,
  outcomes: ['写作'],
  defer: null,
  tomorrow: '写提纲',
};

const quietFacts: EveningDigestFacts = {
  completed: 0,
  openToday: 0,
  outcomes: [],
  defer: null,
  tomorrow: null,
};

describe('evening digest copy', () => {
  it('names the three branches without the old counter', () => {
    expect(eveningDigestKind(leftoverFacts)).toBe('leftover');
    expect(eveningDigestKind(doneFacts)).toBe('done');
    expect(eveningDigestKind(quietFacts)).toBe('quiet');
    expect(eveningDigestKind({ ...quietFacts, outcomes: ['写作'] })).toBe('progress');

    const leftover = eveningDigestMessage(leftoverFacts);
    expect(leftover).toContain('今天完成了 1 件');
    expect(leftover).toContain('写作有推进');
    expect(leftover).toContain('「周报」已经连着推迟 4 次，可以先放下');
    expect(leftover).toContain('明天可以先做「写提纲」');
    expect(leftover).not.toContain('没处理');
    expect(leftover).not.toMatch(/还有\s*\d+\s*件/);

    const done = eveningDigestMessage(doneFacts);
    expect(done).toContain('今天的都做完了，完成了 2 件');
    expect(done).toContain('明天先做「写提纲」');
    expect(done).not.toContain('没处理');
    expect(done).not.toContain('还有');

    const noTomorrow = eveningDigestMessage({ ...doneFacts, outcomes: [], tomorrow: null });
    expect(noTomorrow).toContain('今天的都做完了');
    expect(noTomorrow).toContain('明天还没有排定的第一件');
    expect(eveningDigestMessage(quietFacts)).toBe('');
  });

  it('drops a rewrite that nags or forgets a name', () => {
    const rule = eveningDigestMessage(doneFacts);
    expect(acceptEveningDigestText('今天的都做完了，完成了 2 件。明天先做「写提纲」。写作有推进。', doneFacts, rule)).toContain('写提纲');
    expect(acceptEveningDigestText('今天还有 2 件没处理', doneFacts, rule)).toBe(rule);
    expect(acceptEveningDigestText('今天加油', doneFacts, rule)).toBe(rule);
    expect(acceptEveningDigestText('今天的都做完了，完成了 2 件。', doneFacts, rule)).toBe(rule);
  });
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
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildFastify();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    setMeowTransport(null);
    setEveningDigestRewrite(null);
  });

  afterAll(async () => {
    await app.close();
  });

  async function channel(userId: string) {
    const postJson = vi.fn((_url: string, _body: Record<string, unknown>) =>
      Promise.resolve({ httpStatus: 200, json: { status: 200, message: 'ok' } }),
    );
    setMeowTransport({ postJson });
    await getDb().insert(notificationChannels).values({
      id: randomUUID(),
      userId,
      type: 'meow',
      enabled: true,
      config: { nickname: 'Ada' },
      createdAt: afternoon,
      updatedAt: afternoon,
    });
    return postJson;
  }

  async function seedLeftover(userId: string, listId: string): Promise<void> {
    const doneId = randomUUID();
    const outcomeId = randomUUID();
    await getDb().insert(outcomes).values({
      id: outcomeId,
      userId,
      name: '写作',
      lastActivityAt: afternoon,
    });
    await getDb().insert(tasks).values([
      {
        id: doneId,
        userId,
        listId,
        outcomeId,
        title: '写完一节',
        timezone: TZ,
        status: 'done',
        isAllDay: true,
        dueAt: dueToday,
        createdAt: afternoon,
        updatedAt: afternoon,
        sortOrder: 1,
      },
      {
        id: randomUUID(),
        userId,
        listId,
        title: '周报',
        timezone: TZ,
        status: 'todo',
        isAllDay: true,
        dueAt: dueToday,
        deferCount: 4,
        createdAt: afternoon,
        updatedAt: afternoon,
        sortOrder: 2,
      },
      {
        id: randomUUID(),
        userId,
        listId,
        title: '只推迟了两次',
        timezone: TZ,
        status: 'todo',
        isAllDay: false,
        dueAt: DateTime.fromISO('2026-09-26T09:00:00', { zone: TZ }).toJSDate(),
        deferCount: 2,
        createdAt: afternoon,
        updatedAt: afternoon,
        sortOrder: 3,
      },
      {
        id: randomUUID(),
        userId,
        listId,
        title: '喝水',
        timezone: TZ,
        status: 'todo',
        isAllDay: true,
        dueAt: dueToday,
        habitId: randomUUID(),
        createdAt: afternoon,
        updatedAt: afternoon,
        sortOrder: 4,
      },
      {
        id: randomUUID(),
        userId,
        listId,
        title: '写提纲',
        timezone: TZ,
        status: 'todo',
        isAllDay: true,
        dueAt: dueTomorrow,
        priority: 1,
        createdAt: afternoon,
        updatedAt: afternoon,
        sortOrder: 5,
      },
    ]);
    await getDb().insert(taskCompletions).values({
      id: randomUUID(),
      taskId: doneId,
      occurrenceAt: dueToday,
      completedAt: afternoon,
      dueWasNull: false,
    });
  }

  async function seedDone(userId: string, listId: string): Promise<void> {
    const doneId = randomUUID();
    const outcomeId = randomUUID();
    await getDb().insert(outcomes).values({
      id: outcomeId,
      userId,
      name: '写作',
      lastActivityAt: afternoon,
    });
    await getDb().insert(tasks).values([
      {
        id: doneId,
        userId,
        listId,
        outcomeId,
        title: '写完一节',
        timezone: TZ,
        status: 'done',
        isAllDay: true,
        dueAt: dueToday,
        createdAt: afternoon,
        updatedAt: afternoon,
        sortOrder: 1,
      },
      {
        id: randomUUID(),
        userId,
        listId,
        title: '写提纲',
        timezone: TZ,
        status: 'todo',
        isAllDay: true,
        dueAt: dueTomorrow,
        priority: 1,
        createdAt: afternoon,
        updatedAt: afternoon,
        sortOrder: 2,
      },
    ]);
    await getDb().insert(taskCompletions).values({
      id: randomUUID(),
      taskId: doneId,
      occurrenceAt: dueToday,
      completedAt: afternoon,
      dueWasNull: false,
    });
  }

  it('sends leftovers with the new facts and keeps one row per day', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const user = await getUserEntity(alice.id);
    await seedLeftover(alice.id, listId);
    const lateId = randomUUID();
    await getDb().insert(tasks).values({
      id: lateId,
      userId: alice.id,
      listId,
      title: '下午记下的',
      timezone: TZ,
      status: 'todo',
      isAllDay: true,
      dueAt: dueToday,
      createdAt: afternoon,
      updatedAt: afternoon,
      sortOrder: 6,
    });
    const [late] = await getDb().select().from(tasks).where(eq(tasks.id, lateId));
    if (!late) throw new Error('missing late task');
    await syncTaskNotifications(late, user, afternoon);
    const lateRows = await getDb()
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.entityId, lateId));
    expect(lateRows).toHaveLength(0);

    expect(await countEveningDigestTasks(alice.id, TZ, afternoon)).toBe(2);
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    expect(await enqueueEveningDigests(afternoon)).toBe(0);
    const pending = await getDb().select().from(notificationOutbox);
    expect(pending).toHaveLength(1);
    const slot = pending[0];
    if (!slot) throw new Error('missing digest');
    expect(slot.eventType).toBe('task.digest');
    expect(slot.idempotencyKey).toBe(`task.digest:${alice.id}:2026-09-24`);
    expect(DateTime.fromJSDate(slot.scheduledAt, { zone: TZ }).toFormat('HH:mm')).toBe('21:00');

    const postJson = await channel(alice.id);
    expect(await processDueNotifications(evening)).toBe(1);
    expect(postJson).toHaveBeenCalledTimes(1);
    const body = postJson.mock.calls[0]?.[1] as { title?: string; msg?: string; url?: string };
    expect(body.title).toBe('晚间提醒');
    expect(body.title).not.toBe('晨报');
    expect(body.msg).toContain('今天完成了 1 件');
    expect(body.msg).toContain('写作有推进');
    expect(body.msg).toContain('周报');
    expect(body.msg).toContain('可以先放下');
    expect(body.msg).toContain('写提纲');
    expect(body.msg).not.toContain('没处理');
    expect(body.msg).not.toContain('只推迟了两次');
    expect(body.url).toBe('http://localhost:5180/today');
    const [sent] = await getDb().select().from(notificationOutbox);
    expect(sent?.status).toBe('sent');
    expect(sent?.payload.message).toBe(body.msg);
    expect(sent?.payload.digestRule).toBe(body.msg);
    expect(renderMeowMessage(present(sent).payload)).toEqual({ title: '晚间提醒', msg: body.msg });
    expect(pushTargetOf({ eventType: 'task.digest', entityId: alice.id })).toEqual({ kind: 'today' });

    expect(await enqueueEveningDigests(evening)).toBe(0);
    expect(await processDueNotifications(evening)).toBe(0);
  });

  it('affirms a finished day and suggests tomorrow', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedDone(alice.id, listId);
    const postJson = await channel(alice.id);
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    expect(await processDueNotifications(evening)).toBe(1);
    const body = postJson.mock.calls[0]?.[1] as { title?: string; msg?: string };
    expect(body.title).toBe('晚间提醒');
    expect(body.msg).toContain('今天的都做完了，完成了 1 件');
    expect(body.msg).toContain('写作有推进');
    expect(body.msg).toContain('明天先做「写提纲」');
    expect(body.msg).not.toContain('没处理');
    expect(body.msg).not.toContain('还有');
    const [sent] = await getDb().select().from(notificationOutbox);
    expect(sent?.status).toBe('sent');
  });

  it('cancels a day with no activity', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await getDb().insert(tasks).values({
      id: randomUUID(),
      userId: alice.id,
      listId,
      title: '喝水',
      timezone: TZ,
      status: 'done',
      isAllDay: true,
      dueAt: dueToday,
      habitId: randomUUID(),
      createdAt: afternoon,
      updatedAt: afternoon,
      sortOrder: 1,
    });
    const habitId = (await getDb().select({ id: tasks.id }).from(tasks))[0]?.id;
    if (!habitId) throw new Error('missing habit task');
    await getDb().insert(taskCompletions).values({
      id: randomUUID(),
      taskId: habitId,
      occurrenceAt: dueToday,
      completedAt: afternoon,
      dueWasNull: false,
    });
    const postJson = await channel(alice.id);
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    expect(await processDueNotifications(evening)).toBe(1);
    expect(postJson).not.toHaveBeenCalled();
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.status).toBe('cancelled');
    expect(row?.lastError).toBe('no activity');
  });

  it('mentions an outcome that moved when nothing else did', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const outcomeId = randomUUID();
    await getDb().insert(outcomes).values({ id: outcomeId, userId: alice.id, name: '写作' });
    await getDb().insert(tasks).values({
      id: randomUUID(),
      userId: alice.id,
      listId,
      outcomeId,
      title: '改了标题',
      timezone: TZ,
      status: 'todo',
      isAllDay: true,
      dueAt: DateTime.fromISO('2026-09-28', { zone: TZ }).startOf('day').toJSDate(),
      createdAt: afternoon,
      updatedAt: afternoon,
      sortOrder: 1,
    });
    const postJson = await channel(alice.id);
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    expect(await processDueNotifications(evening)).toBe(1);
    const body = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(body.msg).toContain('写作有推进');
    expect(body.msg).not.toContain('都做完了');
    expect(body.msg).not.toContain('没处理');
  });

  it('shows an in-app dialog titled 晚间提醒 when no external channel is configured', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedDone(alice.id, listId);
    const messages: string[] = [];
    const socket: SyncSocket = {
      send: (data) => {
        messages.push(data);
      },
      close() {},
      ping() {},
      on() {},
      readyState: 1,
      OPEN: 1,
    };
    subscribe(alice.id, socket);
    try {
      expect(await enqueueEveningDigests(afternoon)).toBe(1);
      expect(await processDueNotifications(evening)).toBe(1);
    } finally {
      unsubscribe(alice.id, socket);
    }
    expect(messages).toHaveLength(1);
    const push = JSON.parse(messages[0] ?? '{}') as { title?: string; body?: string; url?: string };
    expect(push.title).toBe('晚间提醒');
    expect(push.title).not.toBe('晨报');
    expect(push.body).toContain('今天的都做完了');
    expect(push.url).toBe('/today');
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.status).toBe('pending');
  });

  it('sends the rule copy when the model is down, vague, or over budget', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedDone(alice.id, listId);
    const postJson = await channel(alice.id);
    setEveningDigestRewrite(() => Promise.reject(new Error('down')));
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    expect(await processDueNotifications(evening)).toBe(1);
    const failed = postJson.mock.calls[0]?.[1] as { title?: string; msg?: string };
    expect(failed.title).toBe('晚间提醒');
    expect(failed.msg).toContain('今天的都做完了，完成了 1 件');
    expect(failed.msg).toContain('写提纲');
    const [sent] = await getDb().select().from(notificationOutbox);
    expect(sent?.status).toBe('sent');
    expect(sent?.lastError).toBeNull();

    await getDb().delete(notificationOutbox);
    postJson.mockClear();
    setEveningDigestRewrite(() => Promise.resolve('今天加油'));
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    expect(await processDueNotifications(evening)).toBe(1);
    const vague = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(vague.msg).toContain('写提纲');
    expect(vague.msg).not.toContain('今天加油');

    await getDb().delete(notificationOutbox);
    postJson.mockClear();
    const called = vi.fn(() => Promise.resolve('不应调用'));
    setEveningDigestRewrite(called);
    await getDb().delete(agentModelBudgets).where(eq(agentModelBudgets.userId, alice.id));
    await getDb().update(users).set({ dailyModelCallLimit: 1 }).where(eq(users.id, alice.id));
    await getDb().transaction((tx) => reserveBackgroundModelCall(tx, alice.id, evening));
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    expect(await processDueNotifications(evening)).toBe(1);
    expect(called).not.toHaveBeenCalled();
    const capped = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(capped.msg).toContain('今天的都做完了');
    const [cappedRow] = await getDb().select().from(notificationOutbox);
    expect(cappedRow?.status).toBe('sent');
  });

  it('uses a rewrite that keeps the facts', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedDone(alice.id, listId);
    const postJson = await channel(alice.id);
    const line = '今天的都做完了，完成了 1 件。写作有推进。明天先做「写提纲」。';
    setEveningDigestRewrite(() => Promise.resolve(line));
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    expect(await processDueNotifications(evening)).toBe(1);
    const body = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(body.msg).toBe(line);
    const [sent] = await getDb().select().from(notificationOutbox);
    expect(sent?.payload.digestRule).toContain('今天的都做完了');
    expect(sent?.payload.message).toBe(line);
  });

  it('does not call the model again when a crash already saved the rule', async () => {
    const alice = await registerUser(app);
    const postJson = await channel(alice.id);
    expect(await enqueueEveningDigests(afternoon)).toBe(1);
    const called = vi.fn(() => Promise.resolve('不应再调用'));
    setEveningDigestRewrite(called);
    await getDb()
      .update(notificationOutbox)
      .set({
        payload: {
          title: '晚间提醒',
          listId: '',
          listName: '',
          dueAt: null,
          remindAt: null,
          isAllDay: false,
          timezone: TZ,
          eventType: 'task.digest',
          message: '规则兜底原文',
          digestRule: '规则兜底原文',
        },
      })
      .where(eq(notificationOutbox.userId, alice.id));
    expect(await processDueNotifications(evening)).toBe(1);
    expect(called).not.toHaveBeenCalled();
    const body = postJson.mock.calls[0]?.[1] as { title?: string; msg?: string };
    expect(body.title).toBe('晚间提醒');
    expect(body.msg).toBe('规则兜底原文');
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
    const postJson = await channel(alice.id);
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
