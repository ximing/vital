import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { db } from '../src/db/index.js';
import { entityLinks, reports } from '../src/db/schema.js';
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

describe('reports', () => {
  it('GET /reports/current is get-or-create and snapshots the previous period', async () => {
    const alice = await registerUser(app);
    const tz = 'Asia/Shanghai';
    const prevStart = DateTime.now().setZone(tz).startOf('day').minus({ days: 1 }).toISODate();
    const prevEnd = DateTime.now().setZone(tz).startOf('day').toISODate();
    const prevId = randomUUID();
    await db.insert(reports).values({
      id: prevId,
      userId: alice.id,
      type: 'daily',
      periodStart: prevStart ?? '2026-01-01',
      periodEnd: prevEnd ?? '2026-01-02',
      title: '昨天 日报',
      bodyMd: '# 昨天 日报\n\nold body\n',
      revision: 2,
    });

    const first = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=daily',
      token: alice.token,
    });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.type).toBe('daily');
    expect(body.revision).toBe(1);
    expect(body.id).not.toBe(prevId);
    expect(body.bodyMd).toContain('## 进行中');
    expect(body.bodyMd).toContain('## 稍后读');
    expect(body.embeds).toEqual({ tasks: {}, inbox: {} });

    const again = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=daily',
      token: alice.token,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(body.id);

    const [nowFrozen] = await db.select().from(reports).where(eq(reports.id, prevId));
    expect(nowFrozen?.snapshotAt).not.toBeNull();
    expect(nowFrozen?.snapshotJson).toMatchObject({ bodyMd: '# 昨天 日报\n\nold body\n', revision: 2 });

    const past = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/reports/current?type=daily&at=${prevStart}`,
      token: alice.token,
    });
    expect(past.statusCode).toBe(200);
    expect(past.json().id).toBe(prevId);

    const hist = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/reports/${prevId}?asOf=snapshot`,
      token: alice.token,
    });
    expect(hist.statusCode).toBe(200);
    expect(hist.json().bodyMd).toBe('# 昨天 日报\n\nold body\n');
  });

  it('fill inserts open tasks in period ∪ overdue and inbox captured in period', async () => {
    const alice = await registerUser(app);
    const list = await inboxId(app, alice.token);
    const tz = 'Asia/Shanghai';
    const todayStart = DateTime.now().setZone(tz).startOf('day');
    const yesterday = todayStart.minus({ days: 1 }).toISO();
    const todayNoon = todayStart.plus({ hours: 12 }).toISO();
    const nextWeek = todayStart.plus({ days: 8 }).toISO();

    const overdue = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '逾期', listId: list, dueAt: yesterday, timezone: tz },
    });
    const inPeriod = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '今天', listId: list, dueAt: todayNoon, timezone: tz },
    });
    const future = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '下周', listId: list, dueAt: nextWeek, timezone: tz },
    });
    const done = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '已完成', listId: list, dueAt: todayNoon, timezone: tz },
    });
    expect(overdue.statusCode).toBe(201);
    expect(inPeriod.statusCode).toBe(201);
    expect(future.statusCode).toBe(201);
    expect(done.statusCode).toBe(201);
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${done.json().id}/complete`,
      token: alice.token,
    });

    const inboxKeep = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: '本周期稍后读' },
    });
    const inboxArchived = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/inbox',
      token: alice.token,
      payload: { title: '已归档' },
    });
    expect(inboxKeep.statusCode).toBe(201);
    expect(inboxArchived.statusCode).toBe(201);
    await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/inbox/${inboxArchived.json().id}`,
      token: alice.token,
      payload: { status: 'archived' },
    });

    const current = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=daily',
      token: alice.token,
    });
    expect(current.statusCode).toBe(200);
    const stripped = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/reports/${current.json().id}`,
      token: alice.token,
      payload: { revision: current.json().revision, bodyMd: '# 自定义\n' },
    });
    expect(stripped.statusCode).toBe(200);
    expect(stripped.json().bodyMd).not.toContain('## 进行中');

    const filled = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/reports/${current.json().id}/fill`,
      token: alice.token,
      payload: { revision: stripped.json().revision },
    });
    expect(filled.statusCode).toBe(200);
    const md = filled.json().bodyMd as string;
    expect(md).toContain('## 进行中');
    expect(md).toContain('## 稍后读');
    expect(md).toContain(`[[task:${overdue.json().id}]]`);
    expect(md).toContain(`[[task:${inPeriod.json().id}]]`);
    expect(md).not.toContain(`[[task:${future.json().id}]]`);
    expect(md).not.toContain(`[[task:${done.json().id}]]`);
    expect(md).toContain(`[[inbox:${inboxKeep.json().id}]]`);
    expect(md).not.toContain(`[[inbox:${inboxArchived.json().id}]]`);
    expect(md.includes('[ ]')).toBe(false);
    expect(filled.json().revision).toBe(Number(stripped.json().revision) + 1);
    expect(filled.json().embeds.tasks[overdue.json().id].status).toBe('todo');
    expect(filled.json().embeds.inbox[inboxKeep.json().id].title).toBe('本周期稍后读');

    const links = await db.select().from(entityLinks);
    expect(links.some((l) => l.role === 'embeds' && l.toId === overdue.json().id)).toBe(true);

    const again = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/reports/${current.json().id}/fill`,
      token: alice.token,
      payload: { revision: filled.json().revision },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().bodyMd.split(`[[task:${overdue.json().id}]]`).length - 1).toBe(1);
  });

  it('PATCH and fill return 409 REPORT_REVISION_CONFLICT on stale revision', async () => {
    const alice = await registerUser(app);
    const current = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=daily',
      token: alice.token,
    });
    const id = current.json().id as string;
    const patch = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/reports/${id}`,
      token: alice.token,
      payload: { revision: 1, title: '改过了' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().revision).toBe(2);

    const stalePatch = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/reports/${id}`,
      token: alice.token,
      payload: { revision: 1, title: '冲突' },
    });
    expect(stalePatch.statusCode).toBe(409);
    expect(stalePatch.json().error.code).toBe('REPORT_REVISION_CONFLICT');

    const staleFill = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/reports/${id}/fill`,
      token: alice.token,
      payload: { revision: 1 },
    });
    expect(staleFill.statusCode).toBe(409);
    expect(staleFill.json().error.code).toBe('REPORT_REVISION_CONFLICT');
  });

  it('embeds hydrate live task status without mutating bodyMd', async () => {
    const alice = await registerUser(app);
    const list = await inboxId(app, alice.token);
    const task = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '芯片', listId: list },
    });
    const current = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=daily',
      token: alice.token,
    });
    const id = current.json().id as string;
    const token = `[[task:${task.json().id}]]`;
    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/reports/${id}`,
      token: alice.token,
      payload: { revision: 1, bodyMd: `# x\n\n${token}\n` },
    });
    expect(patched.json().embeds.tasks[task.json().id].status).toBe('todo');

    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${task.json().id}/complete`,
      token: alice.token,
    });
    const embeds = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/reports/${id}/embeds`,
      token: alice.token,
    });
    expect(embeds.statusCode).toBe(200);
    expect(embeds.json().embeds.tasks[task.json().id].status).toBe('done');
    const live = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/reports/${id}`,
      token: alice.token,
    });
    expect(live.json().bodyMd).toContain(token);
    expect(live.json().embeds.tasks[task.json().id].status).toBe('done');
  });

  it('GET /sync/head watermarks move when tasks change even if reports do not', async () => {
    const alice = await registerUser(app);
    await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=daily',
      token: alice.token,
    });
    const before = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/sync/head',
      token: alice.token,
    });
    expect(before.statusCode).toBe(200);
    const list = await inboxId(app, alice.token);
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: 'watermark', listId: list },
    });
    const after = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/sync/head',
      token: alice.token,
    });
    expect(after.json().tasksMaxUpdatedAt).not.toBe(before.json().tasksMaxUpdatedAt);
    expect(after.json().revision).toBeGreaterThan(before.json().revision);
  });

  it('weekly fill uses 未完成 / 结转 heading', async () => {
    const alice = await registerUser(app);
    const current = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=weekly',
      token: alice.token,
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().bodyMd).toContain('## 未完成 / 结转');
    expect(current.json().title).toContain('周报');
  });

  it('freezes carried at period end and annotates later completions on review', async () => {
    const alice = await registerUser(app);
    const list = await inboxId(app, alice.token);
    const tz = 'Asia/Shanghai';
    const todayStart = DateTime.now().setZone(tz).startOf('day');
    const prevStart = todayStart.minus({ days: 1 }).toISODate();
    const prevEnd = todayStart.toISODate();
    const yesterdayNoon = todayStart.minus({ days: 1 }).plus({ hours: 12 }).toISO();
    const prevId = randomUUID();
    await db.insert(reports).values({
      id: prevId,
      userId: alice.id,
      type: 'daily',
      periodStart: prevStart ?? '2026-01-01',
      periodEnd: prevEnd ?? '2026-01-02',
      title: '昨天 日报',
      bodyMd: '# 昨天 日报\n',
      revision: 1,
    });
    const task = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '结转的事', listId: list, dueAt: yesterdayNoon, timezone: tz },
    });
    expect(task.statusCode).toBe(201);

    // Reading the ended period's review lazily freezes the carried list —
    // without ever opening today's report.
    const before = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/reports/${prevId}/review`,
      token: alice.token,
    });
    expect(before.statusCode).toBe(200);
    const carriedBefore = before.json().carried as Array<Record<string, unknown>>;
    expect(carriedBefore.map((row) => row.title)).toContain('结转的事');
    expect(carriedBefore.find((row) => row.title === '结转的事')).toMatchObject({
      status: 'todo',
      completedAt: null,
      deleted: false,
    });

    const [frozen] = await db.select().from(reports).where(eq(reports.id, prevId));
    expect(frozen?.snapshotAt).not.toBeNull();
    expect(frozen?.snapshotJson?.carried).toEqual([
      expect.objectContaining({ taskId: task.json().id, title: '结转的事' }),
    ]);

    // Completing the task today must not erase it from yesterday's carried list.
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${task.json().id}/complete`,
      token: alice.token,
    });
    const after = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/reports/${prevId}/review`,
      token: alice.token,
    });
    expect(after.statusCode).toBe(200);
    const carriedAfter = after.json().carried as Array<Record<string, unknown>>;
    expect(carriedAfter.map((row) => row.title)).toContain('结转的事');
    expect(carriedAfter.find((row) => row.title === '结转的事')).toMatchObject({
      status: 'done',
      deleted: false,
    });
    expect(
      carriedAfter.find((row) => row.title === '结转的事')?.completedAt,
    ).toBeTruthy();

    // The current period's review stays live.
    const today = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=daily',
      token: alice.token,
    });
    expect(today.statusCode).toBe(200);
    const todayReview = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/reports/${today.json().id}/review`,
      token: alice.token,
    });
    expect(todayReview.statusCode).toBe(200);
    expect(
      (todayReview.json().carried as Array<Record<string, unknown>>).map((row) => row.title),
    ).not.toContain('结转的事');
  });

  it('overview counts completions and review lists done vs carried', async () => {
    const alice = await registerUser(app);
    const list = await inboxId(app, alice.token);
    const tz = 'Asia/Shanghai';
    const todayNoon = DateTime.now().setZone(tz).startOf('day').plus({ hours: 12 }).toISO();
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '写纪要', listId: list, dueAt: todayNoon, timezone: tz, priority: 1 },
    });
    expect(created.statusCode).toBe(201);
    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${created.json().id}/complete`,
      token: alice.token,
    });
    expect(done.statusCode).toBe(200);
    const open = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/tasks',
      token: alice.token,
      payload: { title: '还没做', listId: list, dueAt: todayNoon, timezone: tz },
    });
    expect(open.statusCode).toBe(201);

    const overview = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/overview?type=daily',
      token: alice.token,
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().totals.completed).toBe(1);
    expect(overview.json().totals.carried).toBeGreaterThanOrEqual(1);
    expect(overview.json().recentDone[0]?.title).toBe('写纪要');
    expect(overview.json().heatmap.length).toBeGreaterThan(0);

    const current = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=daily',
      token: alice.token,
    });
    const review = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/reports/${current.json().id}/review`,
      token: alice.token,
    });
    expect(review.statusCode).toBe(200);
    expect(review.json().completed.map((row: { title: string }) => row.title)).toContain('写纪要');
    expect(review.json().carried.map((row: { title: string }) => row.title)).toContain('还没做');
  });

  it('fill does not count as wrote on overview', async () => {
    const alice = await registerUser(app);
    const current = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/current?type=daily',
      token: alice.token,
    });
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/reports/${current.json().id}/fill`,
      token: alice.token,
      payload: { revision: current.json().revision },
    });
    const overview = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/overview?type=daily',
      token: alice.token,
    });
    expect(overview.json().totals.wrote).toBe(0);

    const currentBody = current.json() as { id: string; revision: number; bodyMd: string };
    const patched = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/reports/${currentBody.id}`,
      token: alice.token,
      payload: {
        revision: currentBody.revision + 1,
        bodyMd: `${currentBody.bodyMd}留下一句。\n`,
      },
    });
    expect(patched.statusCode).toBe(200);
    const after = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/overview?type=daily',
      token: alice.token,
    });
    expect(after.json().totals.wrote).toBe(1);
  });

  it('GET /reports/counts returns per-type totals scoped to the user', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);

    const empty = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/counts',
      token: alice.token,
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ daily: 0, weekly: 0, monthly: 0, yearly: 0 });

    for (const [user, type] of [
      [alice, 'daily'],
      [alice, 'weekly'],
      [bob, 'daily'],
    ] as const) {
      const res = await injectJson(app, {
        method: 'GET',
        url: `/api/v1/reports/current?type=${type}`,
        token: user.token,
      });
      expect(res.statusCode).toBe(200);
    }

    const counts = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/reports/counts',
      token: alice.token,
    });
    expect(counts.statusCode).toBe(200);
    expect(counts.json()).toEqual({ daily: 1, weekly: 1, monthly: 0, yearly: 0 });
  });
});
