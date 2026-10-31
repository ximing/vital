/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { buildFastify } from '../../src/app.js';
import { setFactsAdapterForTest } from '../../src/continuity/facts-adapter.js';
import {
  resetFixtureFactsForTest,
  setFixtureTimeoutAllForTest,
  setFixtureWeatherForTest,
} from '../../src/continuity/facts-adapter.fixture.js';
import {
  generateExplorationWindows,
  setExplorationNowForTest,
} from '../../src/continuity/exploration-windows.js';
import { runDueExplorationVerifications } from '../../src/continuity/exploration-verify.js';
import { getDb } from '../../src/db/index.js';
import {
  explorationProposals,
  explorationVerifications,
  holidayCalendar,
  holidayCalendarSources,
  tasks,
} from '../../src/db/schema.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

const TZ = 'Asia/Shanghai';

function shanghai(iso: string): Date {
  return DateTime.fromISO(iso, { zone: TZ }).toJSDate();
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  setExplorationNowForTest(null);
  setFactsAdapterForTest(null);
  resetFixtureFactsForTest();
});

afterEach(() => {
  setExplorationNowForTest(null);
  setFactsAdapterForTest(null);
  resetFixtureFactsForTest();
});

afterAll(async () => {
  await app.close();
});

async function putSettings(
  token: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await injectJson(app, {
    method: 'PUT',
    url: '/api/v1/continuity/settings',
    token,
    payload,
  });
  expect(res.statusCode).toBe(200);
}

async function seedCnNationalDay(sourceVersion = 'v1'): Promise<void> {
  const db = getDb();
  await db.insert(holidayCalendarSources).values({
    region: 'CN',
    sourceUrl: 'https://example.test/cn-holidays',
    fetchedAt: shanghai('2026-01-15T12:00:00'),
    coverageFrom: '2026-01-01',
    coverageTo: '2026-12-31',
    sourceVersion,
    updatedAt: shanghai('2026-01-15T12:00:00'),
  });
  const holidays = [
    '2026-10-01',
    '2026-10-02',
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
  ];
  await db.insert(holidayCalendar).values([
    ...holidays.map((date) => ({
      region: 'CN' as const,
      date,
      kind: 'holiday' as const,
      sourceVersion,
    })),
    { region: 'CN', date: '2026-10-08', kind: 'workday' as const, sourceVersion },
  ]);
}

async function openHolidayWindow(token: string, userId: string) {
  await seedCnNationalDay();
  await putSettings(token, { explorationHoliday: true, explorationWeekend: true, region: 'CN' });
  const now = shanghai('2026-09-21T12:00:00');
  setExplorationNowForTest(now);
  const windows = await generateExplorationWindows(userId, now);
  const holiday = windows.find((row) => row.windowKey.startsWith('holiday:'));
  expect(holiday).toBeDefined();
  return { now, window: holiday! };
}

describe('exploration verify', () => {
  it('marks fixture timeout as unknown, never verified', async () => {
    const alice = await registerUser(app, 'alice');
    setFixtureTimeoutAllForTest(true);
    const { window } = await openHolidayWindow(alice.token, alice.id);
    const got = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/exploration/windows/${window.id}`,
      token: alice.token,
    });
    expect(got.statusCode).toBe(200);
    const body = got.json() as { proposals: Array<{ verifications: Array<{ status: string }> }> };
    expect(body.proposals.length).toBeGreaterThan(0);
    const statuses = body.proposals.flatMap((row) => row.verifications.map((item) => item.status));
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((status) => status === 'unknown')).toBe(true);
    expect(statuses.includes('verified')).toBe(false);
  });

  it('confirm twice creates one task', async () => {
    const alice = await registerUser(app, 'alice');
    const { window } = await openHolidayWindow(alice.token, alice.id);
    const detail = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/exploration/windows/${window.id}`,
      token: alice.token,
    });
    const proposal = (detail.json() as { proposals: Array<{ id: string }> }).proposals[0];
    expect(proposal).toBeDefined();
    const selected = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/select`,
      token: alice.token,
      payload: {},
    });
    expect(selected.statusCode).toBe(200);
    const first = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/confirm`,
      token: alice.token,
      payload: { acceptUnknown: true },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { taskId: string | null; status: string };
    expect(firstBody.status).toBe('confirmed');
    expect(firstBody.taskId).toBeTruthy();
    const second = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/confirm`,
      token: alice.token,
      payload: { acceptUnknown: true },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ taskId: firstBody.taskId, status: 'confirmed' });
    const created = await getDb().select().from(tasks).where(eq(tasks.userId, alice.id));
    expect(created).toHaveLength(1);
    expect(created[0]?.id).toBe(firstBody.taskId);
  });

  it('does not re-offer a rejected activityKey+place within 90 days', async () => {
    const alice = await registerUser(app, 'alice');
    const { window } = await openHolidayWindow(alice.token, alice.id);
    const detail = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/exploration/windows/${window.id}`,
      token: alice.token,
    });
    const proposals = (detail.json() as { proposals: Array<{ id: string; activityKey: string }> })
      .proposals;
    const target = proposals[0];
    expect(target).toBeDefined();
    const rejected = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${target!.id}/reject`,
      token: alice.token,
      payload: {},
    });
    expect(rejected.statusCode).toBe(200);

    const weekendNow = shanghai('2026-10-09T12:00:00');
    setExplorationNowForTest(weekendNow);
    const again = await generateExplorationWindows(alice.id, weekendNow);
    const weekend = again.find((row) => row.windowKey.startsWith('weekend:'));
    expect(weekend).toBeDefined();
    const weekendDetail = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/exploration/windows/${weekend!.id}`,
      token: alice.token,
    });
    expect(weekendDetail.statusCode).toBe(200);
    const keys = (
      weekendDetail.json() as { proposals: Array<{ activityKey: string; rejectedAt: string | null }> }
    ).proposals
      .filter((row) => row.rejectedAt === null)
      .map((row) => row.activityKey);
    expect(keys).not.toContain(target!.activityKey);
  });

  it('does not add proposals after the window is rested', async () => {
    const alice = await registerUser(app, 'alice');
    const { window } = await openHolidayWindow(alice.token, alice.id);
    const rest = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/windows/${window.id}/rest`,
      token: alice.token,
      payload: {},
    });
    expect(rest.statusCode).toBe(200);
    const before = await getDb()
      .select()
      .from(explorationProposals)
      .where(eq(explorationProposals.windowId, window.id));
    const generated = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/windows/${window.id}/generate`,
      token: alice.token,
      payload: {},
    });
    expect(generated.statusCode).toBe(200);
    expect((generated.json() as { status: string }).status).toBe('rest');
    const after = await getDb()
      .select()
      .from(explorationProposals)
      .where(eq(explorationProposals.windowId, window.id));
    expect(after).toHaveLength(before.length);
  });

  it('requires acceptUnknown when facts are unknown', async () => {
    const alice = await registerUser(app, 'alice');
    setFixtureTimeoutAllForTest(true);
    const { window } = await openHolidayWindow(alice.token, alice.id);
    const detail = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/exploration/windows/${window.id}`,
      token: alice.token,
    });
    const proposal = (detail.json() as { proposals: Array<{ id: string }> }).proposals[0];
    const selected = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/select`,
      token: alice.token,
      payload: {},
    });
    expect(selected.statusCode).toBe(200);
    const denied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/confirm`,
      token: alice.token,
      payload: {},
    });
    expect(denied.statusCode).toBe(409);
    expect(denied.json()).toMatchObject({ error: { code: 'EXPLORATION_FACTS_UNKNOWN' } });
    const accepted = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/confirm`,
      token: alice.token,
      payload: { acceptUnknown: true },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ status: 'confirmed' });
    const created = await getDb().select().from(tasks).where(eq(tasks.userId, alice.id));
    expect(created).toHaveLength(1);
  });

  it('records material weather change and does not auto-modify the task', async () => {
    const alice = await registerUser(app, 'alice');
    const { window } = await openHolidayWindow(alice.token, alice.id);
    const detail = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/exploration/windows/${window.id}`,
      token: alice.token,
    });
    const proposal = (detail.json() as { proposals: Array<{ id: string }> }).proposals[0];
    const selected = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/select`,
      token: alice.token,
      payload: {},
    });
    expect(selected.statusCode).toBe(200);
    const confirmed = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/confirm`,
      token: alice.token,
      payload: { acceptUnknown: true },
    });
    expect(confirmed.statusCode).toBe(200);
    const taskId = (confirmed.json() as { taskId: string }).taskId;
    const [before] = await getDb().select().from(tasks).where(eq(tasks.id, taskId));
    expect(before).toBeDefined();

    const row = (
      await getDb().select().from(explorationProposals).where(eq(explorationProposals.id, proposal!.id))
    )[0];
    const dateYmd = window.startDate;
    setFixtureWeatherForTest(row?.place ?? null, dateYmd, {
      field: 'weather',
      value: { condition: 'rain', summary: '有雨，不宜户外' },
      url: 'https://fixture.vital.test/weather',
      fetchedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
      status: 'verified',
    });
    await getDb()
      .update(explorationProposals)
      .set({ nextVerifyAt: shanghai('2026-09-21T11:00:00') })
      .where(eq(explorationProposals.id, proposal!.id));

    const n = await runDueExplorationVerifications(shanghai('2026-09-21T12:00:00'));
    expect(n).toBeGreaterThan(0);
    const verifications = await getDb()
      .select()
      .from(explorationVerifications)
      .where(eq(explorationVerifications.proposalId, proposal!.id));
    expect(verifications.some((item) => item.field === 'weather' && item.status === 'changed')).toBe(
      true,
    );
    const [after] = await getDb().select().from(tasks).where(eq(tasks.id, taskId));
    expect(after?.title).toBe(before?.title);
    expect(after?.dueAt?.toISOString()).toBe(before?.dueAt?.toISOString());
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
  });

  it('returns 404 for another user on select, confirm, reject, and generate', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const { window } = await openHolidayWindow(alice.token, alice.id);
    const detail = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/exploration/windows/${window.id}`,
      token: alice.token,
    });
    const proposal = (detail.json() as { proposals: Array<{ id: string }> }).proposals[0];
    const generate = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/windows/${window.id}/generate`,
      token: bob.token,
      payload: {},
    });
    expect(generate.statusCode).toBe(404);
    const select = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/select`,
      token: bob.token,
      payload: {},
    });
    expect(select.statusCode).toBe(404);
    const confirm = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/confirm`,
      token: bob.token,
      payload: { acceptUnknown: true },
    });
    expect(confirm.statusCode).toBe(404);
    const reject = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/proposals/${proposal!.id}/reject`,
      token: bob.token,
      payload: {},
    });
    expect(reject.statusCode).toBe(404);
  });
});
