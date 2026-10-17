import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { present } from '../helpers/present.js';
import { DateTime } from 'luxon';
import { buildTodayPlan } from '@vital/dto';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import {
  agentModelBudgets,
  notificationChannels,
  notificationOutbox,
  tasks,
  todayLayouts,
  userLlmRoutes,
  users,
} from '../../src/db/schema.js';
import { saveTodayLayoutContext } from '../../src/agent/today-layout.js';
import { reserveBackgroundModelCall } from '../../src/agent/model-budget.js';
import { renderMeowMessage, processDueNotifications } from '../../src/notifications/dispatch.js';
import { subscribe, unsubscribe, type SyncSocket } from '../../src/sync/sync.hub.js';
import { pushTargetOf } from '../../src/notifications/huawei-push.js';
import {
  acceptMorningBriefText,
  enqueueMorningBriefs,
  meetingGaps,
  morningBriefTemplate,
  morningBriefWhen,
  setMorningBriefComplete,
  todayPageRecentlyOpen,
  TODAY_PAGE_OPEN_MS,
} from '../../src/notifications/morning-brief.js';
import { setMeowTransport } from '../../src/notifications/meow.js';
import { resetDb } from '../helpers/db.js';
import { inboxId, registerUser } from '../helpers/session.js';

const TZ = 'Asia/Shanghai';
const early = DateTime.fromISO('2026-09-24T06:00:00', { zone: TZ }).toJSDate();
const briefAt = DateTime.fromISO('2026-09-24T07:30:00', { zone: TZ }).toJSDate();
const dueYesterday = DateTime.fromISO('2026-09-23', { zone: TZ }).startOf('day').toJSDate();

const meetings = {
  status: 'events' as const,
  events: [
    { title: '站会', start: '09:00', allDay: false },
    { title: '评审', start: '10:00', allDay: false },
    { title: '复盘', start: '12:00', allDay: false },
  ],
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  setMeowTransport(null);
  setMorningBriefComplete(null);
});

afterAll(async () => {
  await app.close();
});

function gapFacts() {
  const plan = buildTodayPlan(
    [{ id: 't1', title: '写报告', status: 'todo', dueAt: '2026-09-23T00:00:00.000Z', startAt: null, priority: 3, isAllDay: true }],
    TZ,
    briefAt,
  );
  return {
    plan,
    meetings: meetings.events,
    weather: '上海 多云 22°C',
  };
}

describe('morning brief rules', () => {
  it('waits for 07:30, catches up after, and moves through quiet hours', () => {
    const waiting = morningBriefWhen(early, TZ, '07:30', null, null);
    expect(waiting?.day).toBe('2026-09-24');
    expect(DateTime.fromJSDate(present(waiting).scheduledAt, { zone: TZ }).toFormat('HH:mm')).toBe('07:30');

    const late = morningBriefWhen(briefAt, TZ, '07:30', null, null);
    expect(late?.scheduledAt.toISOString()).toBe(briefAt.toISOString());

    const quiet = morningBriefWhen(early, TZ, '07:30', '07:00', '08:00');
    expect(DateTime.fromJSDate(present(quiet).scheduledAt, { zone: TZ }).toFormat('HH:mm')).toBe('08:00');

    const nextDay = morningBriefWhen(early, TZ, '07:30', '07:00', '06:00');
    expect(DateTime.fromJSDate(present(nextDay).scheduledAt, { zone: TZ }).toISODate()).toBe('2026-09-25');

    const ny = morningBriefWhen(
      DateTime.fromISO('2026-09-24T06:00:00', { zone: 'America/New_York' }).toJSDate(),
      'America/New_York',
      '07:30',
      null,
      null,
    );
    expect(ny?.day).toBe('2026-09-24');
    expect(DateTime.fromJSDate(present(ny).scheduledAt, { zone: 'America/New_York' }).toFormat('HH:mm')).toBe('07:30');
  });

  it('finds gaps of at least an hour and ignores all-day events', () => {
    expect(meetingGaps([
      { title: '站会', start: '09:00', allDay: false },
      { title: '评审', start: '10:00', allDay: false },
      { title: '复盘', start: '12:00', allDay: false },
      { title: '出差', start: '2026-09-24', allDay: true },
    ])).toEqual([
      { after: '站会', before: '评审', minutes: 60 },
      { after: '评审', before: '复盘', minutes: 120 },
    ]);
    expect(meetingGaps([
      { title: '站会', start: '09:00', allDay: false },
      { title: '评审', start: '09:30', allDay: false },
    ])).toEqual([]);
  });

  it('stays one sentence without advice when nothing is overdue or scheduled', () => {
    const text = morningBriefTemplate({
      plan: buildTodayPlan([], TZ, briefAt),
      meetings: [],
      weather: '上海 多云',
    });
    expect(text).toBe('今天 0 件，没有逾期');
    expect(text).not.toContain('建议');
    expect(text).not.toContain('空档');
  });

  it('names the tight gap and a task to move', () => {
    const text = morningBriefTemplate(gapFacts());
    expect(text).toContain('空档');
    expect(text).toContain('建议');
    expect(text).toContain('写报告');
    expect(text).toContain('站会');
    expect(text).toContain('1 小时');
  });

  it('drops a model line that invents or omits the gap', () => {
    const template = morningBriefTemplate(gapFacts());
    expect(acceptMorningBriefText('三个会中间只有 1 小时空档，建议把写报告挪到明天', 2, template)).toContain('空档');
    expect(acceptMorningBriefText('今天加油', 2, template)).toBe(template);
    expect(acceptMorningBriefText('中间有个空档可以喝咖啡', 0, '今天 1 件，没有逾期')).toBe('今天 1 件，没有逾期');
  });

  it('treats a today-page report inside 30 minutes as open', () => {
    const at = briefAt.getTime() - TODAY_PAGE_OPEN_MS;
    expect(todayPageRecentlyOpen({ reportedAt: new Date(at).toISOString() }, briefAt)).toBe(true);
    expect(todayPageRecentlyOpen({ reportedAt: new Date(at - 1).toISOString() }, briefAt)).toBe(false);
    expect(todayPageRecentlyOpen({ reportedAt: new Date(briefAt.getTime() + 1000).toISOString() }, briefAt)).toBe(false);
    expect(todayPageRecentlyOpen({}, briefAt)).toBe(false);
  });
});

describe('morning brief delivery', () => {
  async function seedGap(userId: string, listId: string) {
    await getDb().insert(tasks).values({
      id: randomUUID(),
      userId,
      listId,
      title: '写报告',
      timezone: TZ,
      status: 'todo',
      dueAt: dueYesterday,
      createdAt: early,
      sortOrder: 1,
    });
    await getDb().insert(todayLayouts).values({
      userId,
      modules: [],
      context: { meetings, weather: { status: 'ready', place: '上海', condition: '多云', temperatureC: 22 } },
      updatedAt: early,
    });
  }

  function channel(userId: string) {
    const postJson = vi.fn((_url: string, _body: Record<string, unknown>) =>
      Promise.resolve({ httpStatus: 200, json: { status: 200, message: 'ok' } }),
    );
    setMeowTransport({ postJson });
    return getDb()
      .insert(notificationChannels)
      .values({
        id: randomUUID(),
        userId,
        type: 'meow',
        enabled: true,
        config: { nickname: 'Ada' },
        createdAt: early,
        updatedAt: early,
      })
      .then(() => postJson);
  }

  it('stores one row per user per day and can point the clock', async () => {
    const alice = await registerUser(app);
    expect(await enqueueMorningBriefs(early)).toBe(1);
    expect(await enqueueMorningBriefs(early)).toBe(0);
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.eventType).toBe('agent.briefing');
    expect(row?.idempotencyKey).toBe(`agent.briefing:${alice.id}:2026-09-24`);
    expect(DateTime.fromJSDate(present(row).scheduledAt, { zone: TZ }).toFormat('HH:mm')).toBe('07:30');

    await getDb().delete(notificationOutbox).where(eq(notificationOutbox.userId, alice.id));
    await getDb().update(users).set({ morningBriefTime: '06:45' }).where(eq(users.id, alice.id));
    expect(await enqueueMorningBriefs(early)).toBe(1);
    const [moved] = await getDb().select().from(notificationOutbox);
    expect(DateTime.fromJSDate(present(moved).scheduledAt, { zone: TZ }).toFormat('HH:mm')).toBe('06:45');
  });

  it('does not schedule when the switch is off or quiet hours land tomorrow', async () => {
    const alice = await registerUser(app);
    await getDb().update(users).set({ notifyMorningBrief: false }).where(eq(users.id, alice.id));
    expect(await enqueueMorningBriefs(early)).toBe(0);

    await getDb()
      .update(users)
      .set({ notifyMorningBrief: true, quietHoursStart: '07:00', quietHoursEnd: '06:00' })
      .where(eq(users.id, alice.id));
    expect(await enqueueMorningBriefs(early)).toBe(0);
    expect(await getDb().select().from(notificationOutbox)).toHaveLength(0);
  });

  it('sends a template with a gap suggestion and opens today', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedGap(alice.id, listId);
    const postJson = await channel(alice.id);
    expect(await enqueueMorningBriefs(early)).toBe(1);
    expect(await processDueNotifications(briefAt)).toBe(1);
    expect(postJson).toHaveBeenCalledTimes(1);
    const body = postJson.mock.calls[0]?.[1] as { title?: string; msg?: string; url?: string };
    expect(body.title).toBe('晨报');
    expect(body.msg).toContain('空档');
    expect(body.msg).toContain('建议');
    expect(body.msg).toContain('写报告');
    expect(body.url).toBe('http://localhost:5180/today');
    const [sent] = await getDb().select().from(notificationOutbox);
    expect(sent?.status).toBe('sent');
    expect(sent?.payload.message).toBe(body.msg);
    expect(pushTargetOf({ eventType: 'agent.briefing', entityId: alice.id })).toEqual({ kind: 'today' });
    expect(renderMeowMessage(present(sent).payload)).toEqual({ title: '晨报', msg: body.msg });
    expect(await enqueueMorningBriefs(briefAt)).toBe(0);
    expect(await processDueNotifications(briefAt)).toBe(0);
  });

  it('pushes an in-app /today path when no external channel is configured', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedGap(alice.id, listId);
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
      expect(await enqueueMorningBriefs(early)).toBe(1);
      expect(await processDueNotifications(briefAt)).toBe(1);
    } finally {
      unsubscribe(alice.id, socket);
    }
    expect(messages).toHaveLength(1);
    const push = JSON.parse(messages[0] ?? '{}') as { title?: string; body?: string; url?: string };
    expect(push.title).toBe('晨报');
    expect(push.body).toContain('空档');
    expect(push.body).toContain('建议');
    expect(push.url).toBe('/today');
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.status).toBe('pending');
  });

  it('keeps the template when the model is down, vague, or over budget', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedGap(alice.id, listId);
    const postJson = await channel(alice.id);
    setMorningBriefComplete(() => Promise.reject(new Error('down')));
    expect(await enqueueMorningBriefs(early)).toBe(1);
    expect(await processDueNotifications(briefAt)).toBe(1);
    const failed = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(failed.msg).toContain('空档');
    expect(failed.msg).toContain('建议');

    await getDb().delete(notificationOutbox);
    postJson.mockClear();
    setMorningBriefComplete(() => Promise.resolve('今天加油'));
    expect(await enqueueMorningBriefs(early)).toBe(1);
    expect(await processDueNotifications(briefAt)).toBe(1);
    const vague = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(vague.msg).toContain('空档');
    expect(vague.msg).not.toContain('今天加油');

    await getDb().delete(notificationOutbox);
    postJson.mockClear();
    const called = vi.fn(() => Promise.resolve('不应调用'));
    setMorningBriefComplete(called);
    await getDb().delete(agentModelBudgets).where(eq(agentModelBudgets.userId, alice.id));
    await getDb().update(users).set({ dailyModelCallLimit: 1 }).where(eq(users.id, alice.id));
    await getDb().transaction((tx) => reserveBackgroundModelCall(tx, alice.id, briefAt));
    expect(await enqueueMorningBriefs(early)).toBe(1);
    expect(await processDueNotifications(briefAt)).toBe(1);
    expect(called).not.toHaveBeenCalled();
    const capped = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(capped.msg).toContain('空档');
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.status).toBe('sent');
  });

  it('uses the model line when it keeps the gap', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedGap(alice.id, listId);
    const postJson = await channel(alice.id);
    setMorningBriefComplete(() => Promise.resolve('三个会中间只有 1 小时空档，建议把写报告挪到明天'));
    expect(await enqueueMorningBriefs(early)).toBe(1);
    expect(await processDueNotifications(briefAt)).toBe(1);
    const body = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(body.msg).toBe('三个会中间只有 1 小时空档，建议把写报告挪到明天');
  });

  it('sends the short line and does not call the model', async () => {
    const alice = await registerUser(app);
    const called = vi.fn(() => Promise.resolve('建议你休息'));
    setMorningBriefComplete(called);
    const postJson = await channel(alice.id);
    expect(await enqueueMorningBriefs(early)).toBe(1);
    expect(await processDueNotifications(briefAt)).toBe(1);
    expect(called).not.toHaveBeenCalled();
    const body = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(body.msg).toBe('今天 0 件，没有逾期');
    expect(body.msg).not.toContain('建议');
  });

  it('skips when today was opened within 30 minutes', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedGap(alice.id, listId);
    const opened = new Date(briefAt.getTime() - TODAY_PAGE_OPEN_MS);
    await getDb()
      .update(todayLayouts)
      .set({ context: { meetings, reportedAt: opened.toISOString() } })
      .where(eq(todayLayouts.userId, alice.id));
    const postJson = await channel(alice.id);
    expect(await enqueueMorningBriefs(early)).toBe(1);
    expect(await processDueNotifications(briefAt)).toBe(1);
    expect(postJson).not.toHaveBeenCalled();
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.status).toBe('cancelled');
    expect(row?.lastError).toBe('today page open');
  });

  it('still sends when the today page was opened 31 minutes earlier', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedGap(alice.id, listId);
    const opened = new Date(briefAt.getTime() - TODAY_PAGE_OPEN_MS - 1);
    await getDb()
      .update(todayLayouts)
      .set({ context: { meetings, reportedAt: opened.toISOString() } })
      .where(eq(todayLayouts.userId, alice.id));
    const postJson = await channel(alice.id);
    expect(await enqueueMorningBriefs(early)).toBe(1);
    expect(await processDueNotifications(briefAt)).toBe(1);
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending brief after the switch is turned off', async () => {
    const alice = await registerUser(app);
    const postJson = await channel(alice.id);
    expect(await enqueueMorningBriefs(early)).toBe(1);
    await getDb().update(users).set({ notifyMorningBrief: false }).where(eq(users.id, alice.id));
    expect(await processDueNotifications(briefAt)).toBe(1);
    expect(postJson).not.toHaveBeenCalled();
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.status).toBe('cancelled');
    expect(row?.lastError).toBe('morning brief off');
  });

  it('delays inside quiet hours and drops a delay that crosses midnight', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await seedGap(alice.id, listId);
    const postJson = await channel(alice.id);
    expect(await enqueueMorningBriefs(early)).toBe(1);
    await getDb()
      .update(users)
      .set({ quietHoursStart: '07:00', quietHoursEnd: '08:00' })
      .where(eq(users.id, alice.id));
    expect(await processDueNotifications(briefAt)).toBe(1);
    expect(postJson).not.toHaveBeenCalled();
    const [delayed] = await getDb().select().from(notificationOutbox);
    expect(delayed?.status).toBe('pending');
    expect(DateTime.fromJSDate(present(delayed).scheduledAt, { zone: TZ }).toFormat('HH:mm')).toBe('08:00');

    await getDb().delete(notificationOutbox);
    await getDb()
      .update(users)
      .set({ quietHoursStart: null, quietHoursEnd: null })
      .where(eq(users.id, alice.id));
    expect(await enqueueMorningBriefs(early)).toBe(1);
    await getDb()
      .update(users)
      .set({ quietHoursStart: '07:00', quietHoursEnd: '06:00' })
      .where(eq(users.id, alice.id));
    expect(await processDueNotifications(briefAt)).toBe(1);
    const [dropped] = await getDb().select().from(notificationOutbox);
    expect(dropped?.status).toBe('cancelled');
    expect(dropped?.lastError).toBe('quiet hours crossed midnight');
  });

  it('stamps a today-page report and allows the briefing route', async () => {
    const alice = await registerUser(app);
    await saveTodayLayoutContext(alice.id, { weather: null, meetings }, early);
    const [layout] = await getDb().select().from(todayLayouts).where(eq(todayLayouts.userId, alice.id));
    expect(layout?.context).toMatchObject({
      reportedAt: early.toISOString(),
      meetings: { status: 'events' },
    });
    await getDb()
      .update(todayLayouts)
      .set({ modules: [{ id: 'lead' }], updatedAt: briefAt })
      .where(eq(todayLayouts.userId, alice.id));
    const [kept] = await getDb().select().from(todayLayouts).where(eq(todayLayouts.userId, alice.id));
    expect((kept?.context as { reportedAt?: string }).reportedAt).toBe(early.toISOString());

    await getDb().insert(userLlmRoutes).values({
      userId: alice.id,
      capability: 'agent.briefing',
      providerId: randomUUID(),
      model: 'test-model',
    });
    const [route] = await getDb().select().from(userLlmRoutes).where(eq(userLlmRoutes.userId, alice.id));
    expect(route?.capability).toBe('agent.briefing');
  });
});
