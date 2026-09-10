import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueProactiveInsights, selectInsightCandidates } from '../../src/notifications/insights.js';
import { getUserEntity } from '../../src/auth/auth.service.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentJobs, notificationOutbox, outcomes } from '../../src/db/schema.js';
import { enqueueAgentJob, processDueAgentJobs } from '../../src/agent/jobs.js';
import { processDueNotifications, recoverStuckSending } from '../../src/notifications/dispatch.js';
import { setMeowTransport } from '../../src/notifications/meow.js';
import { resetDb } from '../helpers/db.js';
import { registerUser } from '../helpers/session.js';
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
