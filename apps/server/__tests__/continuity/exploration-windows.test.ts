/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { buildFastify } from '../../src/app.js';
import {
  generateExplorationWindows,
  setExplorationNowForTest,
} from '../../src/continuity/exploration-windows.js';
import { getDb } from '../../src/db/index.js';
import { holidayCalendar, holidayCalendarSources } from '../../src/db/schema.js';
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
});

afterEach(() => {
  setExplorationNowForTest(null);
});

afterAll(async () => {
  await app.close();
});

async function putSettings(
  token: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await injectJson(app, {
    method: 'PUT',
    url: '/api/v1/continuity/settings',
    token,
    payload,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, unknown>;
}

async function listWindows(token: string): Promise<{ items: Array<Record<string, unknown>> }> {
  const res = await injectJson(app, {
    method: 'GET',
    url: '/api/v1/exploration/windows',
    token,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { items: Array<Record<string, unknown>> };
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

describe('exploration windows', () => {
  it('does not treat a 调休 workday in a holiday week as a free day', async () => {
    const alice = await registerUser(app, 'alice');
    await seedCnNationalDay();
    await putSettings(alice.token, { explorationHoliday: true, region: 'CN' });
    const now = shanghai('2026-09-21T12:00:00');
    setExplorationNowForTest(now);
    const windows = await generateExplorationWindows(alice.id, now);
    const holiday = windows.find((row) => row.windowKey.startsWith('holiday:'));
    expect(holiday).toMatchObject({
      startDate: '2026-10-01',
      endDate: '2026-10-07',
      status: 'open',
      region: 'CN',
    });
    expect(windows.some((row) => row.startDate <= '2026-10-08' && row.endDate >= '2026-10-08')).toBe(
      false,
    );
    const listed = await listWindows(alice.token);
    expect(listed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ startDate: '2026-10-01', endDate: '2026-10-07', status: 'open' }),
      ]),
    );
  });

  it('does not guess CN holidays when region is unknown', async () => {
    const alice = await registerUser(app, 'alice');
    await seedCnNationalDay();
    await putSettings(alice.token, { explorationHoliday: true, explorationWeekend: false });
    const now = shanghai('2026-09-28T12:00:00');
    const windows = await generateExplorationWindows(alice.id, now, {
      idleDates: ['2026-10-03', '2026-10-04'],
    });
    expect(windows.filter((row) => row.windowKey.startsWith('holiday:'))).toEqual([]);
    expect(windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          windowKey: 'idle:2026-10-03:2026-10-04',
          startDate: '2026-10-03',
          endDate: '2026-10-04',
          region: null,
        }),
      ]),
    );
  });

  it('rest closes a window and regenerate does not reopen it', async () => {
    const alice = await registerUser(app, 'alice');
    await seedCnNationalDay();
    await putSettings(alice.token, { explorationHoliday: true, region: 'CN' });
    const now = shanghai('2026-09-21T12:00:00');
    const [window] = await generateExplorationWindows(alice.id, now);
    expect(window?.status).toBe('open');
    const rest = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/windows/${window!.id}/rest`,
      token: alice.token,
      payload: {},
    });
    expect(rest.statusCode).toBe(200);
    expect(rest.json()).toMatchObject({
      id: window!.id,
      status: 'rest',
      closedReason: 'rest',
    });
    const again = await generateExplorationWindows(alice.id, now);
    const same = again.find((row) => row.id === window!.id);
    expect(same).toMatchObject({ status: 'rest', closedReason: 'rest' });
    expect(again.filter((row) => row.windowKey === window!.windowKey)).toHaveLength(1);
  });

  it('sourceVersion update does not reopen closed windows', async () => {
    const alice = await registerUser(app, 'alice');
    await seedCnNationalDay('v1');
    await putSettings(alice.token, { explorationHoliday: true, region: 'CN' });
    const now = shanghai('2026-09-21T12:00:00');
    const [window] = await generateExplorationWindows(alice.id, now);
    expect(window?.calendarVersion).toBe('v1');
    const rest = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/windows/${window!.id}/rest`,
      token: alice.token,
      payload: {},
    });
    expect(rest.statusCode).toBe(200);

    await getDb()
      .update(holidayCalendarSources)
      .set({ sourceVersion: 'v2', updatedAt: shanghai('2026-09-01T12:00:00') })
      .where(eq(holidayCalendarSources.region, 'CN'));
    await getDb()
      .update(holidayCalendar)
      .set({ sourceVersion: 'v2' })
      .where(eq(holidayCalendar.region, 'CN'));

    const again = await generateExplorationWindows(alice.id, now);
    const same = again.find((row) => row.windowKey === window!.windowKey);
    expect(same).toMatchObject({
      id: window!.id,
      status: 'rest',
      closedReason: 'rest',
      calendarVersion: 'v2',
    });
  });

  it('weekend exploration is off by default', async () => {
    const alice = await registerUser(app, 'alice');
    await seedCnNationalDay();
    await putSettings(alice.token, { explorationHoliday: true, region: 'CN' });
    const now = shanghai('2026-10-09T12:00:00');
    const off = await generateExplorationWindows(alice.id, now);
    expect(off.filter((row) => row.windowKey.startsWith('weekend:'))).toEqual([]);

    await putSettings(alice.token, { explorationWeekend: true, region: 'CN' });
    const on = await generateExplorationWindows(alice.id, now);
    expect(on).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          windowKey: 'weekend:2026-10-10:2026-10-11',
          startDate: '2026-10-10',
          endDate: '2026-10-11',
          status: 'open',
        }),
      ]),
    );
  });

  it('returns 404 when another user rests or reads a window', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    await seedCnNationalDay();
    await putSettings(alice.token, { explorationHoliday: true, region: 'CN' });
    const now = shanghai('2026-09-21T12:00:00');
    const [window] = await generateExplorationWindows(alice.id, now);
    expect(window).toBeDefined();

    const rest = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/exploration/windows/${window!.id}/rest`,
      token: bob.token,
      payload: {},
    });
    expect(rest.statusCode).toBe(404);

    const got = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/exploration/windows/${window!.id}`,
      token: bob.token,
    });
    expect(got.statusCode).toBe(404);

    const bobList = await listWindows(bob.token);
    expect(bobList.items).toEqual([]);
  });

  it('skips public holidays when coverage metadata is missing', async () => {
    const alice = await registerUser(app, 'alice');
    await getDb().insert(holidayCalendar).values({
      region: 'CN',
      date: '2026-10-01',
      kind: 'holiday',
      sourceVersion: 'orphan',
    });
    await putSettings(alice.token, { explorationHoliday: true, region: 'CN' });
    const windows = await generateExplorationWindows(alice.id, shanghai('2026-09-21T12:00:00'));
    expect(windows.filter((row) => row.windowKey.startsWith('holiday:'))).toEqual([]);
  });
});
