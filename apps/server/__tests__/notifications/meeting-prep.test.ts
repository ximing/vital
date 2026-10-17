import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { buildFastify } from '../../src/app.js';
import { config } from '../../src/config.js';
import { getDb } from '../../src/db/index.js';
import { inboxItems, notificationChannels, notificationOutbox, tasks, users } from '../../src/db/schema.js';
import { renderMeowMessage, processDueNotifications } from '../../src/notifications/dispatch.js';
import { pushTargetOf } from '../../src/notifications/huawei-push.js';
import { setMeowTransport } from '../../src/notifications/meow.js';
import {
  acceptMeetingPrepText,
  MEETING_PREP_LEAD_MS,
  MEETING_PREP_PATH,
  MEETING_PREP_TITLE,
  meetingPrepFire,
  meetingPrepKey,
  meetingPrepMessage,
  selectMeetingPrep,
  setMeetingPrepRewrite,
  setMeetingPrepSimilar,
  enqueueMeetingPreps,
  type MeetingPrepCandidate,
} from '../../src/notifications/meeting-prep.js';
import { subscribe, unsubscribe, type SyncSocket } from '../../src/sync/sync.hub.js';
import { resetDb } from '../helpers/db.js';
import { inboxId, registerUser } from '../helpers/session.js';

const TZ = 'Asia/Shanghai';
const now = DateTime.fromISO('2026-10-15T10:00:00', { zone: TZ }).toJSDate();
const RULE = '「会前鲤鱼卡」约 15 分钟后开始。相关任务：准备会前鲤鱼卡材料。相关笔记：会前鲤鱼卡纪要。';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  setMeetingPrepSimilar(async () => []);
});

afterEach(() => {
  setMeowTransport(null);
  setMeetingPrepSimilar(null);
  setMeetingPrepRewrite(null);
});

afterAll(async () => {
  await app.close();
});

function at(minutes: number): Date {
  return new Date(now.getTime() + minutes * 60 * 1000);
}

function task(partial: Partial<MeetingPrepCandidate> & Pick<MeetingPrepCandidate, 'id' | 'title'>): MeetingPrepCandidate {
  return {
    kind: 'task',
    outcomeId: null,
    open: true,
    similar: false,
    ...partial,
  };
}

describe('meeting prep matching', () => {
  const meeting = { id: 'meet', title: '产品评审会', outcomeId: 'out-1' };

  const candidates: MeetingPrepCandidate[] = [
    task({ id: 't-both', title: '产品评审补充', similar: true }),
    task({ id: 't-similar', title: '财务对账', similar: true }),
    task({ id: 't-word', title: '准备产品评审材料' }),
    task({ id: 't-outcome', title: '写周报', outcomeId: 'out-1' }),
    task({ id: 't-other', title: '写周报', outcomeId: 'out-2' }),
    task({ id: 't-milk', title: '买牛奶' }),
    task({ id: 't-closed', title: '产品评审清单', open: false }),
    task({ id: 't-shut', title: '财务对账', open: false, similar: true }),
    task({ id: 'meet', title: '产品评审会', outcomeId: 'out-1' }),
    {
      id: 'i-similar',
      kind: 'inbox',
      title: '竞品记录',
      outcomeId: null,
      open: true,
      similar: true,
    },
    {
      id: 'i-word',
      kind: 'inbox',
      title: '产品评审纪要',
      outcomeId: null,
      open: true,
      similar: false,
    },
    { id: 'i-miss', kind: 'inbox', title: '菜谱', outcomeId: null, open: true, similar: false },
  ];

  it('keeps shared words, the same outcome, and similar hits, and drops the rest', () => {
    const hits = selectMeetingPrep(meeting, candidates);
    expect(hits.tasks.map((item) => item.id)).toEqual(['t-both', 't-similar', 't-word', 't-outcome']);
    expect(hits.inbox.map((item) => item.id)).toEqual(['i-similar', 'i-word']);
  });

  it('does not treat a shared time word as a match', () => {
    const hits = selectMeetingPrep(
      { id: 'm', title: '今天开会', outcomeId: null },
      [task({ id: 't', title: '今天下午买菜' })],
    );
    expect(hits.tasks).toEqual([]);
    expect(hits.inbox).toEqual([]);
  });

  it('matches a shared latin word', () => {
    const hits = selectMeetingPrep(
      { id: 'm', title: 'Roadmap sync', outcomeId: null },
      [task({ id: 't', title: 'Update the roadmap' })],
    );
    expect(hits.tasks.map((item) => item.id)).toEqual(['t']);
  });

  it('caps related tasks at five', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      task({ id: `t${String(index)}`, title: `产品评审材料${String(index)}` }),
    );
    expect(selectMeetingPrep({ id: 'm', title: '产品评审会', outcomeId: null }, many).tasks).toHaveLength(5);
  });

  it('names the meeting and only the related titles', () => {
    expect(meetingPrepMessage('会前鲤鱼卡', ['准备会前鲤鱼卡材料'], ['会前鲤鱼卡纪要'])).toBe(RULE);
    expect(meetingPrepMessage('会前鲤鱼卡', ['准备会前鲤鱼卡材料'], [])).toBe(
      '「会前鲤鱼卡」约 15 分钟后开始。相关任务：准备会前鲤鱼卡材料。',
    );
  });

  it('drops a rewrite that forgets a name', () => {
    expect(acceptMeetingPrepText('今天加油', '会前鲤鱼卡', ['准备会前鲤鱼卡材料'], RULE)).toBe(RULE);
    expect(
      acceptMeetingPrepText('会前鲤鱼卡快到了，先看准备会前鲤鱼卡材料', '会前鲤鱼卡', ['准备会前鲤鱼卡材料'], RULE),
    ).toBe('会前鲤鱼卡快到了，先看准备会前鲤鱼卡材料');
  });

  it('fires inside the lead window and skips quiet hours that cover the start', () => {
    const soon = at(10);
    expect(meetingPrepFire(now, soon, null, null, TZ, 20 * 60 * 1000)?.toISOString()).toBe(now.toISOString());

    const later = at(18);
    const lead = new Date(later.getTime() - MEETING_PREP_LEAD_MS);
    expect(meetingPrepFire(now, later, null, null, TZ, 20 * 60 * 1000)?.toISOString()).toBe(lead.toISOString());

    expect(meetingPrepFire(now, at(30), null, null, TZ, 20 * 60 * 1000)).toBeNull();
    expect(meetingPrepFire(now, at(-5), null, null, TZ, 20 * 60 * 1000)).toBeNull();
    expect(meetingPrepFire(now, soon, '09:00', '12:00', TZ, 20 * 60 * 1000)).toBeNull();

    const quietEnd = DateTime.fromISO('2026-10-15T10:05:00', { zone: TZ }).toJSDate();
    expect(meetingPrepFire(at(-10), soon, '09:00', '10:05', TZ, 30 * 60 * 1000)?.toISOString()).toBe(
      quietEnd.toISOString(),
    );
  });
});

describe('meeting prep delivery', () => {
  async function meeting(userId: string, listId: string, start: Date, title = '会前鲤鱼卡'): Promise<string> {
    const id = randomUUID();
    await getDb().insert(tasks).values({
      id,
      userId,
      listId,
      title,
      timezone: TZ,
      status: 'todo',
      startAt: start,
      dueAt: start,
      isAllDay: false,
      calendarKey: `ios:${id}`,
      priority: 3,
      createdAt: now,
      sortOrder: 1,
    });
    return id;
  }

  async function plain(userId: string, listId: string, title: string): Promise<string> {
    const id = randomUUID();
    await getDb().insert(tasks).values({
      id,
      userId,
      listId,
      title,
      timezone: TZ,
      status: 'todo',
      createdAt: now,
      sortOrder: 2,
    });
    return id;
  }

  async function note(userId: string, title: string): Promise<string> {
    const id = randomUUID();
    await getDb().insert(inboxItems).values({
      id,
      userId,
      title,
      status: 'unread',
      source: 'manual',
      createdAt: now,
      updatedAt: now,
    });
    return id;
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
        createdAt: now,
        updatedAt: now,
      })
      .then(() => postJson);
  }

  function listen(userId: string): { messages: string[]; stop: () => void } {
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
    subscribe(userId, socket);
    return { messages, stop: () => unsubscribe(userId, socket) };
  }

  it('stores one row per task start and schedules the remainder of the lead', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const start = at(10);
    const id = await meeting(alice.id, listId, start);
    expect(await enqueueMeetingPreps(now)).toBe(1);
    expect(await enqueueMeetingPreps(now)).toBe(0);
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.eventType).toBe('meeting.prep');
    expect(row?.idempotencyKey).toBe(meetingPrepKey(id, start));
    expect(row?.scheduledAt.toISOString()).toBe(now.toISOString());

    await getDb().delete(notificationOutbox);
    await getDb().delete(tasks);
    const ahead = new Date(now.getTime() + MEETING_PREP_LEAD_MS + Math.min(5_000, config.WORKER_POLL_MS - 1));
    await meeting(alice.id, listId, ahead);
    expect(await enqueueMeetingPreps(now)).toBe(1);
    const [waiting] = await getDb().select().from(notificationOutbox);
    expect(waiting?.scheduledAt.toISOString()).toBe(new Date(ahead.getTime() - MEETING_PREP_LEAD_MS).toISOString());
  });

  it('does not push when nothing matches, and will not try that start again', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await meeting(alice.id, listId, at(10));
    await plain(alice.id, listId, '买牛奶');
    const ear = listen(alice.id);
    try {
      expect(await enqueueMeetingPreps(now)).toBe(1);
      expect(await processDueNotifications(now)).toBe(1);
    } finally {
      ear.stop();
    }
    expect(ear.messages).toEqual([]);
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.status).toBe('cancelled');
    expect(row?.lastError).toBe('no match');
    expect(await enqueueMeetingPreps(now)).toBe(0);
  });

  it('sends the rule card to the meetings anchor', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const meetingId = await meeting(alice.id, listId, at(10));
    const taskId = await plain(alice.id, listId, '准备会前鲤鱼卡材料');
    const noteId = await note(alice.id, '会前鲤鱼卡纪要');
    await plain(alice.id, listId, '买牛奶');
    const postJson = await channel(alice.id);
    const ear = listen(alice.id);
    try {
      expect(await enqueueMeetingPreps(now)).toBe(1);
      expect(await processDueNotifications(now)).toBe(1);
    } finally {
      ear.stop();
    }
    expect(postJson).toHaveBeenCalledTimes(1);
    const body = postJson.mock.calls[0]?.[1] as { title?: string; msg?: string; url?: string };
    expect(body.title).toBe(MEETING_PREP_TITLE);
    expect(body.title).not.toBe('晨报');
    expect(body.title).not.toBe('晚间提醒');
    expect(body.title).not.toBe('还做吗');
    expect(body.msg).toBe(RULE);
    expect(body.url).toBe(`${config.WEB_ORIGIN.replace(/\/$/, '')}${MEETING_PREP_PATH}`);
    const push = JSON.parse(ear.messages[0] ?? '{}') as { title?: string; body?: string; url?: string };
    expect(push).toEqual({ title: MEETING_PREP_TITLE, body: RULE, url: MEETING_PREP_PATH, id: expect.any(String), type: 'notify' });
    const [sent] = await getDb().select().from(notificationOutbox);
    expect(sent?.status).toBe('sent');
    expect(sent?.payload.relatedTaskIds).toEqual([taskId]);
    expect(sent?.payload.relatedInboxIds).toEqual([noteId]);
    expect(sent?.payload.taskId).toBe(meetingId);
    expect(sent?.payload.deeplink).toBe(MEETING_PREP_PATH);
    expect(sent?.payload.prepRule).toBe(RULE);
    expect(renderMeowMessage(sent!.payload)).toEqual({ title: MEETING_PREP_TITLE, msg: RULE });
    expect(pushTargetOf({ eventType: 'meeting.prep', entityId: meetingId })).toEqual({ kind: 'today' });
    expect(await processDueNotifications(now)).toBe(0);
    expect(await enqueueMeetingPreps(now)).toBe(0);
  });

  it('keeps the rule sentence when the model throws', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await meeting(alice.id, listId, at(10));
    await plain(alice.id, listId, '准备会前鲤鱼卡材料');
    await note(alice.id, '会前鲤鱼卡纪要');
    const postJson = await channel(alice.id);
    setMeetingPrepRewrite(() => Promise.reject(new Error('down')));
    expect(await enqueueMeetingPreps(now)).toBe(1);
    expect(await processDueNotifications(now)).toBe(1);
    const body = postJson.mock.calls[0]?.[1] as { title?: string; msg?: string };
    expect(body.title).toBe(MEETING_PREP_TITLE);
    expect(body.msg).toBe(RULE);
    const [sent] = await getDb().select().from(notificationOutbox);
    expect(sent?.status).toBe('sent');
    expect(sent?.lastError).toBeNull();
  });

  it('still sends a title match when retrieval throws', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await meeting(alice.id, listId, at(10));
    const taskId = await plain(alice.id, listId, '准备会前鲤鱼卡材料');
    const postJson = await channel(alice.id);
    setMeetingPrepSimilar(() => Promise.reject(new Error('embed down')));
    expect(await enqueueMeetingPreps(now)).toBe(1);
    expect(await processDueNotifications(now)).toBe(1);
    const body = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(body.msg).toBe('「会前鲤鱼卡」约 15 分钟后开始。相关任务：准备会前鲤鱼卡材料。');
    const [sent] = await getDb().select().from(notificationOutbox);
    expect(sent?.status).toBe('sent');
    expect(sent?.payload.relatedTaskIds).toEqual([taskId]);
  });

  it('pushes an embedding hit that shares no title word', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await meeting(alice.id, listId, at(10));
    const milkId = await plain(alice.id, listId, '买牛奶');
    const postJson = await channel(alice.id);
    setMeetingPrepSimilar(async () => [{ id: milkId, title: '买牛奶' }]);
    expect(await enqueueMeetingPreps(now)).toBe(1);
    expect(await processDueNotifications(now)).toBe(1);
    const body = postJson.mock.calls[0]?.[1] as { msg?: string };
    expect(body.msg).toBe('「会前鲤鱼卡」约 15 分钟后开始。相关任务：买牛奶。');
    const [sent] = await getDb().select().from(notificationOutbox);
    expect(sent?.payload.relatedTaskIds).toEqual([milkId]);
  });

  it('does not schedule when the switch is off, the meeting is not a timed calendar task, or quiet hours cover it', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await getDb().update(users).set({ notifyMeetingPrep: false }).where(eq(users.id, alice.id));
    await meeting(alice.id, listId, at(10));
    expect(await enqueueMeetingPreps(now)).toBe(0);

    await getDb()
      .update(users)
      .set({ notifyMeetingPrep: true, quietHoursStart: '09:00', quietHoursEnd: '12:00' })
      .where(eq(users.id, alice.id));
    expect(await enqueueMeetingPreps(now)).toBe(0);

    await getDb()
      .update(users)
      .set({ quietHoursStart: null, quietHoursEnd: null })
      .where(eq(users.id, alice.id));
    await getDb().delete(tasks);
    await plain(alice.id, listId, '会前鲤鱼卡');
    expect(await enqueueMeetingPreps(now)).toBe(0);

    const allDay = randomUUID();
    await getDb().insert(tasks).values({
      id: allDay,
      userId: alice.id,
      listId,
      title: '会前鲤鱼卡',
      timezone: TZ,
      status: 'todo',
      startAt: at(10),
      dueAt: at(10),
      isAllDay: true,
      calendarKey: `ios:${allDay}`,
      createdAt: now,
    });
    expect(await enqueueMeetingPreps(now)).toBe(0);

    await getDb().delete(tasks);
    await meeting(alice.id, listId, at(120));
    expect(await enqueueMeetingPreps(now)).toBe(0);
    expect(await getDb().select().from(notificationOutbox)).toHaveLength(0);
  });
});
