import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { enqueueAgentJob, processDueAgentJobs } from '../../src/agent/jobs.js';
import { reserveBackgroundModelCall } from '../../src/agent/model-budget.js';
import { runAgentScheduler } from '../../src/agent/scheduler.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import {
  agentExecutions,
  agentJobs,
  agentModelBudgets,
  habits,
  inboxItemTags,
  inboxItems,
  notificationOutbox,
  outcomes,
  reports,
  tags,
  taskCompletions,
  tasks,
  users,
} from '../../src/db/schema.js';
import { processDueNotifications } from '../../src/notifications/dispatch.js';
import {
  acceptWeeklyObserveText,
  detectWeeklyPatterns,
  goalObservePattern,
  isLateNight,
  preferGoalPattern,
  replaceInsightSection,
  setWeeklyObserveRewrite,
  WEEKLY_OBSERVE_TITLE,
  weeklyObserveStats,
  weeklyObserveWhen,
  type ObservePattern,
  type WeeklyObserveSample,
} from '../../src/notifications/weekly-observe.js';
import { subscribe, unsubscribe, type SyncSocket } from '../../src/sync/sync.hub.js';
import { resetDb } from '../helpers/db.js';
import { inboxId, registerUser } from '../helpers/session.js';

const TZ = 'Asia/Shanghai';
const PERIOD = '2026-10-12';
const sundayEvening = DateTime.fromISO('2026-10-18T18:30:00', { zone: TZ }).toJSDate();
const LATE_NIGHT = '这周晚上 11 点后建了 7 个任务——是不是焦虑性记录？';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  setWeeklyObserveRewrite(null);
});

afterEach(() => {
  setWeeklyObserveRewrite(null);
});

afterAll(async () => {
  await app.close();
});

function at(iso: string): Date {
  return DateTime.fromISO(iso, { zone: TZ }).toJSDate();
}

function sample(partial: Partial<WeeklyObserveSample> = {}): WeeklyObserveSample {
  return {
    timeZone: TZ,
    createdAt: [],
    inbox: [],
    defer: [],
    habits: [],
    ...partial,
  };
}

async function addTask(
  userId: string,
  listId: string,
  partial: {
    title: string;
    createdAt: Date;
    updatedAt?: Date;
    status?: string;
    habitId?: string;
    calendarKey?: string;
    outcomeId?: string;
    deferCount?: number;
    deletedAt?: Date;
  },
): Promise<string> {
  const id = randomUUID();
  await getDb().insert(tasks).values({
    id,
    userId,
    listId,
    title: partial.title,
    timezone: TZ,
    status: partial.status ?? 'todo',
    habitId: partial.habitId,
    calendarKey: partial.calendarKey,
    outcomeId: partial.outcomeId,
    deferCount: partial.deferCount ?? 0,
    deletedAt: partial.deletedAt,
    createdAt: partial.createdAt,
    updatedAt: partial.updatedAt ?? partial.createdAt,
    sortOrder: 1,
  });
  return id;
}

async function runObserve(userId: string, when = sundayEvening, periodStart = PERIOD) {
  const id = await enqueueAgentJob(getDb(), {
    userId,
    jobType: 'reflect.weekly',
    payload: { date: periodStart, trigger: 'schedule' },
    dedupKey: `reflect.weekly:${userId}:${periodStart}`,
    scheduledAt: when,
  });
  expect(id).toBeTruthy();
  expect(await processDueAgentJobs(when)).toBe(1);
  const [job] = await getDb().select().from(agentJobs).where(eq(agentJobs.id, id!));
  return job;
}

describe('weekly observe patterns', () => {
  it('turns a fixed week into the late-night sentence and caps at two', () => {
    const createdAt = [
      ...Array.from({ length: 7 }, () => at('2026-10-14T00:30:00')),
      at('2026-10-14T22:59:00'),
      at('2026-10-14T12:00:00'),
    ];
    const stats = weeklyObserveStats(
      sample({
        createdAt,
        inbox: Array.from({ length: 4 }, () => ({ title: '睡眠', tags: [] })),
        defer: [{ title: '拖延周报', outcomeName: '写作', deferCount: 4 }],
        habits: [
          ...[6, 7, 8].map((day) => ({
            name: '早起',
            completedAt: at(`2026-10-0${String(day)}T07:00:00`),
            week: 'prev' as const,
          })),
          ...[13, 14, 15].map((day) => ({
            name: '早起',
            completedAt: at(`2026-10-${String(day)}T09:00:00`),
            week: 'this' as const,
          })),
        ],
      }),
    );
    expect(stats.lateNightCreated).toBe(7);
    const patterns = detectWeeklyPatterns(stats);
    expect(patterns.map((pattern) => pattern.kind)).toEqual(['late_night', 'defer']);
    expect(patterns[0]?.text).toBe(LATE_NIGHT);
    expect(patterns[1]?.text).toBe('「写作」相关的事累计推迟了 4 次，这周还在往后推。');
    expect(detectWeeklyPatterns({ ...stats, stalledMilestones: [{ outcome: '写作', title: '改二稿' }] }).map((pattern) => pattern.kind)).toEqual([
      'late_night',
      'defer',
    ]);
  });

  it('adds a stalled-milestone sentence without inventing one, and keeps the two-pattern cap', () => {
    const empty = weeklyObserveStats(sample());
    expect(empty.stalledMilestones).toEqual([]);
    expect(goalObservePattern(empty)).toBeNull();
    const stalled = goalObservePattern({
      ...empty,
      stalledMilestones: [{ outcome: '写作', title: '改二稿' }],
    });
    expect(stalled?.text).toBe('「写作」有 1 个里程碑这周没动：「改二稿」。');
    const alertOnly = goalObservePattern({
      ...empty,
      alertOutcomes: [{ name: '写作', nextStep: '交大纲' }],
    });
    expect(alertOnly?.text).toBe('「写作」这周需要推一把。下一步是「交大纲」。');
    expect(alertOnly?.text).not.toContain('停滞');
    expect(alertOnly?.text).not.toContain('里程碑');
    const kept = preferGoalPattern(
      [
        { kind: 'late_night', text: '晚', anchors: [] },
        { kind: 'energy', text: '精力', anchors: [] },
      ],
      stalled,
    );
    expect(kept.map((pattern) => pattern.kind)).toEqual(['late_night', 'energy']);
  });

  it('stays silent when every signal is under the line', () => {
    const stats = weeklyObserveStats(
      sample({
        createdAt: Array.from({ length: 4 }, () => at('2026-10-14T23:10:00')),
        inbox: Array.from({ length: 3 }, () => ({ title: '睡眠', tags: ['睡眠'] })),
        defer: [{ title: '拖延周报', outcomeName: null, deferCount: 3 }],
        habits: [
          { name: '早起', completedAt: at('2026-10-06T08:00:00'), week: 'prev' },
          { name: '早起', completedAt: at('2026-10-07T08:00:00'), week: 'prev' },
          { name: '早起', completedAt: at('2026-10-08T08:00:00'), week: 'prev' },
          { name: '早起', completedAt: at('2026-10-13T09:00:00'), week: 'this' },
          { name: '早起', completedAt: at('2026-10-14T09:00:00'), week: 'this' },
          { name: '早起', completedAt: at('2026-10-15T09:00:00'), week: 'this' },
        ],
      }),
    );
    expect(detectWeeklyPatterns(stats)).toEqual([]);
  });

  it('counts local hours 23:00–04:59 and wraps a midnight habit drift', () => {
    expect(isLateNight(at('2026-10-14T22:59:00'), TZ)).toBe(false);
    expect(isLateNight(at('2026-10-14T23:00:00'), TZ)).toBe(true);
    expect(isLateNight(at('2026-10-14T04:59:00'), TZ)).toBe(true);
    expect(isLateNight(at('2026-10-14T05:00:00'), TZ)).toBe(false);
    const stats = weeklyObserveStats(
      sample({
        habits: [
          ...[6, 7, 8].map((day) => ({
            name: '早起',
            completedAt: at(`2026-10-0${String(day)}T23:00:00`),
            week: 'prev' as const,
          })),
          ...[13, 14, 15].map((day) => ({
            name: '早起',
            completedAt: at(`2026-10-${String(day)}T01:00:00`),
            week: 'this' as const,
          })),
        ],
      }),
    );
    expect(detectWeeklyPatterns(stats)[0]?.text).toBe('「早起」的打卡这周比上周晚了约 2 小时。');
  });

  it('prefers a tag over title bigrams and fires on the last evening of the week', () => {
    const tagged = weeklyObserveStats(
      sample({
        inbox: Array.from({ length: 4 }, () => ({ title: '完全无关的标题', tags: ['睡眠'] })),
      }),
    );
    expect(detectWeeklyPatterns(tagged)[0]?.text).toBe('这周未读的「睡眠」攒了 4 条。');
    const before = weeklyObserveWhen(at('2026-10-18T17:59:00'), TZ, 1);
    expect(before).toMatchObject({
      periodStart: '2026-10-12',
      periodEnd: '2026-10-19',
      scheduledAt: at('2026-10-18T18:00:00'),
    });
    const due = weeklyObserveWhen(sundayEvening, TZ, 1);
    expect(due?.scheduledAt.toISOString()).toBe(sundayEvening.toISOString());
    const saturday = weeklyObserveWhen(at('2026-10-15T10:00:00'), TZ, 0);
    expect(saturday).toMatchObject({
      periodStart: '2026-10-11',
      scheduledAt: at('2026-10-17T18:00:00'),
    });
    expect(weeklyObserveWhen(sundayEvening, 'Not/AZone', 1)).toBeNull();
  });

  it('keeps a rewrite only when every number and name survives', () => {
    const patterns: ObservePattern[] = [
      { kind: 'late_night', text: LATE_NIGHT, anchors: [] },
      { kind: 'defer', text: '「写作」相关的事累计推迟了 4 次，这周还在往后推。', anchors: ['写作'] },
    ];
    const rule = patterns.map((pattern) => pattern.text).join('\n');
    expect(acceptWeeklyObserveText('晚上 11 点后建了 7 个，写作累计推迟了 4 次。', patterns, rule)).toBe(
      '晚上 11 点后建了 7 个，写作累计推迟了 4 次。',
    );
    expect(acceptWeeklyObserveText('晚上 11 点后建了 8 个，写作推迟了 4 次。', patterns, rule)).toBe(rule);
    expect(acceptWeeklyObserveText('晚上 11 点后建了 7 个。', patterns, rule)).toBe(rule);
    expect(acceptWeeklyObserveText('## 洞察\n晚上 11 点后建了 7 个，写作 4 次。', patterns, rule)).toBe(rule);
    expect(acceptWeeklyObserveText(`${'很'.repeat(201)}11 7 4 写作`, patterns, rule)).toBe(rule);
  });

  it('writes the insight section without touching 复盘', () => {
    const body = '# 周报\n\n## 本周完成\n\n## 复盘\n\n我写的复盘\n';
    const next = replaceInsightSection(body, LATE_NIGHT);
    expect(next.indexOf('## 洞察')).toBeLessThan(next.indexOf('## 复盘'));
    expect(next).toContain(LATE_NIGHT);
    expect(next).toContain('我写的复盘');
    const again = replaceInsightSection(next, '晚上 11 点后建了 7 个任务。');
    expect(again).toContain('晚上 11 点后建了 7 个任务。');
    expect(again).not.toContain(LATE_NIGHT);
    expect(again).toContain('我写的复盘');
  });
});

describe('reflect.weekly job', () => {
  it('enqueues once for the week, including a user with no task activity', async () => {
    const alice = await registerUser(app);
    const thursday = at('2026-10-15T10:00:00');
    expect(await runAgentScheduler(thursday)).toBe(0);
    const rows = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobType: 'reflect.weekly',
      dedupKey: `reflect.weekly:${alice.id}:${PERIOD}`,
      payload: { date: PERIOD, trigger: 'schedule' },
    });
    expect(rows[0]?.scheduledAt.toISOString()).toBe(at('2026-10-18T18:00:00').toISOString());
    expect(await runAgentScheduler(thursday)).toBe(0);
    expect(await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id))).toHaveLength(1);

    await getDb().update(users).set({ weekStartsOn: 0 }).where(eq(users.id, alice.id));
    await getDb().delete(agentJobs).where(eq(agentJobs.userId, alice.id));
    expect(await runAgentScheduler(thursday)).toBe(0);
    const [shifted] = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, alice.id));
    expect(shifted?.payload).toMatchObject({ date: '2026-10-11' });
    expect(shifted?.scheduledAt.toISOString()).toBe(at('2026-10-17T18:00:00').toISOString());
  });

  it('writes the late-night insight to the weekly report and the outbox', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const habitId = randomUUID();
    await getDb().insert(habits).values({ id: habitId, userId: alice.id, name: '早起', kind: 'daily' });
    for (let i = 0; i < 7; i += 1) {
      await addTask(alice.id, listId, { title: `深夜样本 ${String(i)}`, createdAt: at('2026-10-14T00:30:00') });
    }
    await addTask(alice.id, listId, { title: '白天样本', createdAt: at('2026-10-14T12:00:00') });
    await addTask(alice.id, listId, {
      title: '习惯实例',
      createdAt: at('2026-10-14T00:30:00'),
      habitId,
    });
    await addTask(alice.id, listId, {
      title: '日历实例',
      createdAt: at('2026-10-14T00:30:00'),
      calendarKey: 'ios:weekly-observe',
    });
    await addTask(alice.id, listId, {
      title: '已删除',
      createdAt: at('2026-10-14T00:30:00'),
      deletedAt: sundayEvening,
    });

    const job = await runObserve(alice.id);
    expect(job?.status).toBe('done');
    expect(job?.lastError).toBeNull();

    const [report] = await getDb().select().from(reports).where(eq(reports.userId, alice.id));
    expect(report?.type).toBe('weekly');
    expect(report?.periodStart).toBe(PERIOD);
    expect(report?.bodyMd.indexOf('## 洞察')).toBeGreaterThan(-1);
    expect(report?.bodyMd.indexOf('## 洞察')).toBeLessThan(report!.bodyMd.indexOf('## 复盘'));
    expect(report?.bodyMd).toContain(LATE_NIGHT);
    expect(report?.bodyMd).not.toContain('深夜样本');

    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.eventType).toBe('agent.observe');
    expect(row?.payload.title).toBe(WEEKLY_OBSERVE_TITLE);
    expect(row?.payload.message).toBe(LATE_NIGHT);
    expect(row?.payload.deeplink).toBe(`/reports/${report?.id}?type=weekly`);
    expect(row?.idempotencyKey).toBe(`agent.observe:${alice.id}:${PERIOD}`);

    const [execution] = await getDb().select().from(agentExecutions).where(eq(agentExecutions.jobId, job!.id));
    expect(execution?.inputSummary).toContain('深夜新建 7');
    expect(execution?.inputSummary).not.toContain('深夜样本');
  });

  it('stays silent when the week has no pattern', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    await addTask(alice.id, listId, { title: '买牛奶', createdAt: at('2026-10-14T12:00:00') });
    const called = vi.fn(() => Promise.resolve('不应调用'));
    setWeeklyObserveRewrite(called);
    const job = await runObserve(alice.id);
    expect(job?.status).toBe('done');
    expect(called).not.toHaveBeenCalled();
    expect(await getDb().select().from(notificationOutbox)).toEqual([]);
    expect(await getDb().select().from(reports)).toEqual([]);
    const [execution] = await getDb().select().from(agentExecutions).where(eq(agentExecutions.jobId, job!.id));
    expect(execution?.status).toBe('skipped');
    expect(execution?.reason).toBe('NO_PATTERN');
    expect(execution?.inputSummary).not.toContain('买牛奶');
  });

  it('keeps the rule copy when the model throws or the daily budget is spent', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    for (let i = 0; i < 7; i += 1) {
      await addTask(alice.id, listId, { title: `深夜样本 ${String(i)}`, createdAt: at('2026-10-14T01:00:00') });
    }
    setWeeklyObserveRewrite(() => Promise.reject(new Error('down')));
    const failed = await runObserve(alice.id);
    expect(failed?.status).toBe('done');
    expect(failed?.lastError).toBeNull();
    const [first] = await getDb().select().from(notificationOutbox);
    expect(first?.payload.message).toBe(LATE_NIGHT);

    await getDb().delete(notificationOutbox);
    await getDb().delete(agentJobs);
    await getDb().delete(reports);
    await getDb().update(users).set({ dailyModelCallLimit: 1 }).where(eq(users.id, alice.id));
    await getDb().delete(agentModelBudgets).where(eq(agentModelBudgets.userId, alice.id));
    await getDb().transaction((tx) => reserveBackgroundModelCall(tx, alice.id, sundayEvening));
    const called = vi.fn(() => Promise.resolve('晚上 11 点后建了 7 个任务。'));
    setWeeklyObserveRewrite(called);
    const capped = await runObserve(alice.id);
    expect(capped?.status).toBe('done');
    expect(capped?.lastError).toBeNull();
    expect(called).not.toHaveBeenCalled();
    const [second] = await getDb().select().from(notificationOutbox);
    expect(second?.payload.message).toBe(LATE_NIGHT);
  });

  it('still fills the report when the switch is off, and delays the push through quiet hours', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    for (let i = 0; i < 7; i += 1) {
      await addTask(alice.id, listId, { title: `深夜样本 ${String(i)}`, createdAt: at('2026-10-14T23:10:00') });
    }
    await getDb().update(users).set({ notifyWeeklyObserve: false }).where(eq(users.id, alice.id));
    await runObserve(alice.id);
    expect(await getDb().select().from(notificationOutbox)).toEqual([]);
    const [report] = await getDb().select().from(reports);
    expect(report?.bodyMd).toContain(LATE_NIGHT);

    await getDb().delete(reports);
    await getDb().delete(agentJobs);
    await getDb()
      .update(users)
      .set({ notifyWeeklyObserve: true, quietHoursStart: '17:00', quietHoursEnd: '20:00' })
      .where(eq(users.id, alice.id));
    await runObserve(alice.id);
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.scheduledAt.toISOString()).toBe(at('2026-10-18T20:00:00').toISOString());
    expect(row?.payload.message).toBe(LATE_NIGHT);
  });

  it('opens an in-app dialog titled 本周洞察 on the weekly report path', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    for (let i = 0; i < 7; i += 1) {
      await addTask(alice.id, listId, { title: `深夜样本 ${String(i)}`, createdAt: at('2026-10-14T23:40:00') });
    }
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
      await runObserve(alice.id);
      expect(await processDueNotifications(sundayEvening)).toBe(1);
    } finally {
      unsubscribe(alice.id, socket);
    }
    const push = messages
      .map((raw) => JSON.parse(raw) as { type?: string; title?: string; body?: string; url?: string })
      .find((message) => message.type === 'notify');
    expect(push?.title).toBe('本周洞察');
    expect(push?.title).not.toBe('晨报');
    expect(push?.body).toContain('晚上 11 点后建了 7 个任务');
    expect(push?.url).toMatch(/^\/reports\/[0-9a-f-]{36}\?type=weekly$/);
    expect(push?.url).not.toContain('localhost');
  });

  it('loads inbox tags, defer totals, and habit drift from stored rows', async () => {
    const alice = await registerUser(app);
    const listId = await inboxId(app, alice.token);
    const tagId = randomUUID();
    await getDb().insert(tags).values({ id: tagId, userId: alice.id, name: '睡眠' });
    for (let i = 0; i < 4; i += 1) {
      const id = randomUUID();
      await getDb().insert(inboxItems).values({
        id,
        userId: alice.id,
        title: `无关标题 ${String(i)}`,
        status: 'unread',
        capturedAt: at('2026-10-13T10:00:00'),
      });
      await getDb().insert(inboxItemTags).values({ inboxItemId: id, tagId });
    }
    await getDb().insert(inboxItems).values({
      id: randomUUID(),
      userId: alice.id,
      title: '稍后读的睡眠',
      status: 'later',
      capturedAt: at('2026-10-13T10:00:00'),
    });
    const job = await runObserve(alice.id);
    expect(job?.status).toBe('done');
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.payload.message).toBe('这周未读的「睡眠」攒了 4 条。');

    await getDb().delete(notificationOutbox);
    await getDb().delete(reports);
    await getDb().delete(agentJobs);
    await getDb().delete(inboxItems);
    const outcomeId = randomUUID();
    await getDb().insert(outcomes).values({ id: outcomeId, userId: alice.id, name: '写作' });
    await addTask(alice.id, listId, {
      title: '写作提纲',
      createdAt: at('2026-10-01T10:00:00'),
      updatedAt: at('2026-10-14T11:00:00'),
      outcomeId,
      deferCount: 2,
      status: 'todo',
    });
    await addTask(alice.id, listId, {
      title: '写作草稿',
      createdAt: at('2026-10-01T10:00:00'),
      updatedAt: at('2026-10-15T11:00:00'),
      outcomeId,
      deferCount: 2,
      status: 'doing',
    });
    await addTask(alice.id, listId, {
      title: '写完了',
      createdAt: at('2026-10-01T10:00:00'),
      updatedAt: at('2026-10-15T11:00:00'),
      outcomeId,
      deferCount: 9,
      status: 'done',
    });
    const deferred = await runObserve(alice.id);
    expect(deferred?.status).toBe('done');
    const [deferRow] = await getDb().select().from(notificationOutbox);
    expect(deferRow?.payload.message).toBe('「写作」相关的事累计推迟了 4 次，这周还在往后推。');

    await getDb().delete(notificationOutbox);
    await getDb().delete(reports);
    await getDb().delete(agentJobs);
    await getDb().delete(tasks).where(eq(tasks.userId, alice.id));
    const habitId = randomUUID();
    await getDb().insert(habits).values({ id: habitId, userId: alice.id, name: '早起', kind: 'daily' });
    const stamps = ['2026-10-06T07:00:00', '2026-10-07T07:00:00', '2026-10-08T07:00:00', '2026-10-13T09:00:00', '2026-10-14T09:00:00', '2026-10-15T09:00:00'];
    for (const iso of stamps) {
      const taskId = await addTask(alice.id, listId, {
        title: '早起',
        createdAt: at(iso),
        habitId,
        status: 'done',
      });
      await getDb().insert(taskCompletions).values({
        id: randomUUID(),
        taskId,
        occurrenceAt: at(iso),
        completedAt: at(iso),
        dueWasNull: true,
      });
    }
    const drifted = await runObserve(alice.id);
    expect(drifted?.status).toBe('done');
    const [habitRow] = await getDb().select().from(notificationOutbox);
    expect(habitRow?.payload.message).toBe('「早起」的打卡这周比上周晚了约 2 小时。');
  });

  it('skips a payload that is not a week', async () => {
    const alice = await registerUser(app);
    const id = await enqueueAgentJob(getDb(), {
      userId: alice.id,
      jobType: 'reflect.weekly',
      payload: { date: 'not-a-week' },
      dedupKey: `reflect.weekly:${alice.id}:bad`,
      scheduledAt: sundayEvening,
    });
    expect(await processDueAgentJobs(sundayEvening)).toBe(1);
    const [job] = await getDb().select().from(agentJobs).where(eq(agentJobs.id, id!));
    expect(job?.status).toBe('done');
    expect(await getDb().select().from(notificationOutbox)).toEqual([]);
    const [execution] = await getDb().select().from(agentExecutions).where(eq(agentExecutions.jobId, id!));
    expect(execution?.reason).toBe('INVALID_PAYLOAD');
  });
});
