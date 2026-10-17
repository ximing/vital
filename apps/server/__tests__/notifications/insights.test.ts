import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferFollowupMessage, enqueueProactiveInsights, selectInsightCandidates } from '../../src/notifications/insights.js';
import { getUserEntity } from '../../src/auth/auth.service.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions, agentJobs, notificationOutbox, outcomes, tasks, users } from '../../src/db/schema.js';
import { enqueueAgentJob, processDueAgentJobs } from '../../src/agent/jobs.js';
import { processDueNotifications, recoverStuckSending, renderMeowMessage } from '../../src/notifications/dispatch.js';
import { setMeowTransport } from '../../src/notifications/meow.js';
import { subscribe, unsubscribe, type SyncSocket } from '../../src/sync/sync.hub.js';
import { createTask } from '../../src/tasks/tasks.service.js';
import { resetDb } from '../helpers/db.js';
import { inboxId, registerUser } from '../helpers/session.js';
import { injectJson } from '../helpers/http.js';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

const now = new Date('2026-09-10T13:00:00.000Z');
let app: FastifyInstance;
beforeAll(async () => { app = await buildFastify(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  await resetDb();
});
afterEach(() => { setMeowTransport(null); vi.useRealTimers(); });
afterAll(async () => app.close());

describe('proactive notification rules', () => {
  it('selects stale alert threads from user activity', () => {
    const rows = selectInsightCandidates({ now, timezone: 'Asia/Shanghai', outcomes: [{ id: 'o1', name: '换工作', ruleSignal: 'alert', lastActivityAt: new Date('2026-09-08T12:59:00Z') }], tasks: [], habits: [], dailyReportWritten: true, completedToday: 0 });
    expect(rows).toEqual([{ kind: 'outcome.stale', targetType: 'outcome', targetId: 'o1', title: '换工作', message: '「换工作」已经两天没推进了，今天要不要动一小步？' }]);
  });

  it('selects deferred tasks, last-hour incomplete habits, and missing evening review', () => {
    const rows = selectInsightCandidates({ now, timezone: 'Asia/Shanghai', outcomes: [], dailyReportWritten: false, completedToday: 2, tasks: [{ id: 't1', title: '写方案', deferCount: 3, outcomeId: 'o1' }], habits: [{ id: 'h1', name: '喝水', kind: 'count', targetCount: 8, windowEnd: '22:00', done: 2 }] });
    expect(rows.map((row) => row.kind)).toEqual(['task.decompose', 'habit.window', 'review.missing']);
    expect(rows[0]?.message).toBe(deferFollowupMessage('写方案', 3));
    expect(rows[0]?.message).toContain('是不要做了，还是卡在哪？');
    expect(rows[1]?.message).toBe('今天喝水 2/8，窗口还剩 1 小时。');
  });

  it('skips achieved or expired habits and review before evening', () => {
    const rows = selectInsightCandidates({ now: new Date('2026-09-10T12:30:00Z'), timezone: 'Asia/Shanghai', outcomes: [], tasks: [], dailyReportWritten: false, completedToday: 1, habits: [{ id: 'done', name: '喝水', kind: 'count', targetCount: 8, windowEnd: '22:00', done: 8 }, { id: 'expired', name: '走路', kind: 'count', targetCount: 3, windowEnd: '20:00', done: 1 }] });
    expect(rows).toEqual([]);
  });
});

describe('notify.scan flow', () => {
  it('reserves the daily intent before rewriting, including concurrent scans', async () => {
    const alice = await registerUser(app);
    const created = await injectJson(app, { method: 'POST', url: '/api/v1/outcomes', token: alice.token, payload: { name: '去旅行' } });
    await getDb().update(outcomes).set({ ruleSignal: 'alert', lastActivityAt: new Date('2026-09-01') }).where(eq(outcomes.id, created.json().id as string));
    const user = await getUserEntity(alice.id);
    const rewrite = vi.fn(async () => {
      const rows = await getDb().select().from(notificationOutbox);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('preparing');
      return '去看看下一步';
    });
    await Promise.all([enqueueProactiveInsights(user, now, rewrite), enqueueProactiveInsights(user, now, rewrite)]);
    await enqueueProactiveInsights(user, now, rewrite);
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect((await getDb().select().from(notificationOutbox))[0]).toMatchObject({ status: 'pending', payload: { message: '去看看下一步' } });
    // Crash during preparation: a fresh dispatcher can use the durable fallback.
    await getDb().update(notificationOutbox).set({ status: 'preparing', updatedAt: new Date(Date.now() - 3600_000) });
    expect(await recoverStuckSending()).toBe(1);
    expect((await getDb().select().from(notificationOutbox))[0]?.status).toBe('pending');
    await enqueueProactiveInsights(user, now, rewrite);
    expect(rewrite).toHaveBeenCalledTimes(1);
  });
  it('creates one daily insight and dispatches it through MeoW to today', async () => {
    const alice = await registerUser(app);
    await injectJson(app, { method: 'POST', url: '/api/v1/notification-channels', token: alice.token, payload: { type: 'meow', config: { nickname: 'Ada' } } });
    const created = await injectJson(app, { method: 'POST', url: '/api/v1/outcomes', token: alice.token, payload: { name: '换工作' } });
    const outcomeId = created.json().id as string;
    await getDb().update(outcomes).set({ ruleSignal: 'alert', lastActivityAt: new Date('2026-09-01T00:00:00Z') }).where(eq(outcomes.id, outcomeId));
    await enqueueAgentJob(getDb(), { userId: alice.id, jobType: 'notify.scan', payload: { date: '2026-09-10' }, dedupKey: 'notify.scan:test', scheduledAt: now });
    expect(await processDueAgentJobs(now)).toBe(1);
    expect(await getDb().select().from(notificationOutbox)).toHaveLength(1);
    const postJson = vi.fn<(url: string, body: Record<string, unknown>) => Promise<{ httpStatus: number; json: unknown }>>(() => Promise.resolve({ httpStatus: 200, json: { status: 200, message: 'ok' } }));
    setMeowTransport({ postJson });
    expect(await processDueNotifications(now)).toBe(1);
    expect(postJson.mock.calls[0]?.[1]).toMatchObject({ url: 'http://localhost:5180/today' });
    await enqueueAgentJob(getDb(), { userId: alice.id, jobType: 'notify.scan', payload: { date: '2026-09-10' }, dedupKey: 'notify.scan:test2', scheduledAt: now });
    await processDueAgentJobs(now);
    expect(await getDb().select().from(notificationOutbox)).toHaveLength(1);
    expect((await getDb().select().from(agentJobs)).every((row) => row.status === 'done')).toBe(true);
  });
});

async function deferredTask(userId: string, token: string) {
  const listId = await inboxId(app, token);
  const task = await createTask(userId, { title: '写方案', listId, dueYmd: '2026-09-01', timezone: 'Asia/Shanghai' });
  await getDb().update(tasks).set({ deferCount: 3 }).where(eq(tasks.id, task.id));
  return task;
}

describe('defer follow-up', () => {
  it('asks with the rule question, records a 7-day follow-up, and still sends when rewrite throws', async () => {
    const alice = await registerUser(app);
    const task = await deferredTask(alice.id, alice.token);
    const user = await getUserEntity(alice.id);
    const rewrite = vi.fn(async () => {
      throw new Error('model down');
    });
    await expect(enqueueProactiveInsights(user, now, rewrite)).resolves.toBe(1);
    const [row] = await getDb().select().from(notificationOutbox);
    expect(row?.status).toBe('pending');
    expect(row?.payload).toMatchObject({
      title: '还做吗',
      insightKind: 'task.decompose',
      taskId: task.id,
      deeplink: `/chat?task=${task.id}`,
      message: deferFollowupMessage('写方案', 3),
    });
    const actions = await getDb().select().from(agentActions).where(eq(agentActions.userId, alice.id));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ actionType: 'task.followup', targetId: task.id, feedback: 'dismissed' });

    expect(await enqueueProactiveInsights(user, new Date(now.getTime() + 24 * 3600_000), rewrite)).toBe(0);
    expect(await getDb().select().from(notificationOutbox)).toHaveLength(1);

    expect(await enqueueProactiveInsights(user, new Date(now.getTime() + 8 * 24 * 3600_000), async () => null)).toBe(1);
    expect(await getDb().select().from(notificationOutbox)).toHaveLength(2);
    expect(rewrite).toHaveBeenCalledTimes(1);
  });

  it('opens chat and waits out quiet hours', async () => {
    const alice = await registerUser(app);
    const task = await deferredTask(alice.id, alice.token);
    const user = await getUserEntity(alice.id);
    await getDb().update(users).set({ quietHoursStart: '20:00', quietHoursEnd: '23:00' }).where(eq(users.id, alice.id));
    await enqueueProactiveInsights(user, now);
    const messages: string[] = [];
    const socket: SyncSocket = { send: (data) => { messages.push(data); }, close() {}, ping() {}, on() {}, readyState: 1, OPEN: 1 };
    subscribe(alice.id, socket);
    try {
      expect(await processDueNotifications(now)).toBe(1);
    } finally {
      unsubscribe(alice.id, socket);
    }
    expect(messages).toEqual([]);
    const [held] = await getDb().select().from(notificationOutbox);
    expect(held?.status).toBe('pending');
    expect(held?.scheduledAt && held.scheduledAt.getTime()).toBeGreaterThan(now.getTime());

    await getDb().update(users).set({ quietHoursStart: null, quietHoursEnd: null }).where(eq(users.id, alice.id));
    await getDb().update(notificationOutbox).set({ scheduledAt: now, status: 'pending', nextAttemptAt: null });
    const postJson = vi.fn<(url: string, body: Record<string, unknown>) => Promise<{ httpStatus: number; json: unknown }>>(() => Promise.resolve({ httpStatus: 200, json: { status: 200, message: 'ok' } }));
    setMeowTransport({ postJson });
    await injectJson(app, { method: 'POST', url: '/api/v1/notification-channels', token: alice.token, payload: { type: 'meow', config: { nickname: 'Ada' } } });
    expect(await processDueNotifications(now)).toBe(1);
    const body = postJson.mock.calls[0]?.[1] as { title?: string; msg?: string; url?: string };
    expect(body.title).toBe('还做吗');
    expect(body.msg).toContain('是不要做了，还是卡在哪？');
    expect(body.url).toBe(`http://localhost:5180/chat?task=${task.id}`);
    expect(renderMeowMessage((await getDb().select().from(notificationOutbox))[0]!.payload).title).toBe('还做吗');
  });
});
