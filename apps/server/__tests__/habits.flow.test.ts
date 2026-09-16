import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { getDb } from '../src/db/index.js';
import { lists, tasks } from '../src/db/schema.js';
import { listHabits, spawnDailyHabits } from '../src/habits/habits.service.js';
import { loadHabitHeadlineFacts } from '../src/habits/progress.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { registerUser } from './helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

describe('habits', () => {
  it('creates a count habit and spawns daily instances idempotently', async () => {
    const alice = await registerUser(app);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/habits',
      token: alice.token,
      payload: { name: '喝水', kind: 'count', targetCount: 8, windowStart: '08:00', windowEnd: '22:00' },
    });
    expect(created.statusCode).toBe(200);
    const habitId = created.json().id as string;

    const noon = DateTime.now().setZone('Asia/Shanghai').set({
      hour: 12,
      minute: 0,
      second: 0,
      millisecond: 0,
    }).toJSDate();
    const spawned = await spawnDailyHabits(alice.id, 'Asia/Shanghai', noon);
    expect(spawned).toBe(1);
    // Idempotent: second run on the same day spawns nothing.
    expect(await spawnDailyHabits(alice.id, 'Asia/Shanghai', noon)).toBe(0);

    const list = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/habits',
      token: alice.token,
    });
    expect(list.json()[0]).toMatchObject({ id: habitId, todayTotal: 1, todayDone: 0 });
    const today = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/today',
      token: alice.token,
    });
    const habitTasks = (today.json().tasks as { title: string; similarOpenTasks?: unknown }[]).filter(
      (task) => task.title === '喝水',
    );
    expect(habitTasks.length).toBeGreaterThan(0);
    expect(habitTasks.every((task) => task.similarOpenTasks === undefined)).toBe(true);
  });

  it('counts today progress by habitId and local day, not a leading-wildcard date', async () => {
    const alice = await registerUser(app);
    const water = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/habits',
      token: alice.token,
      payload: { name: '喝水', kind: 'count', targetCount: 8 },
    });
    const stretch = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/habits',
      token: alice.token,
      payload: { name: '拉伸', kind: 'daily' },
    });
    const waterId = water.json().id as string;
    const stretchId = stretch.json().id as string;
    const inboxRows = await getDb()
      .select({ id: lists.id })
      .from(lists)
      .where(eq(lists.userId, alice.id));
    const inbox = inboxRows[0];
    if (!inbox) throw new Error('missing inbox list');
    const tz = 'Asia/Shanghai';
    const now = DateTime.fromISO('2026-09-16T00:30:00', { zone: tz }).toJSDate();
    const today = '2026-09-16';
    const yesterday = '2026-09-15';
    await getDb()
      .insert(tasks)
      .values([
        {
          id: randomUUID(),
          userId: alice.id,
          listId: inbox.id,
          habitId: waterId,
          habitSeq: 1,
          habitKey: `${waterId}:${today}:1`,
          title: '喝水',
          status: 'done',
          timezone: tz,
        },
        {
          id: randomUUID(),
          userId: alice.id,
          listId: inbox.id,
          habitId: waterId,
          habitSeq: 1,
          habitKey: `${waterId}:${yesterday}:1`,
          title: '喝水',
          status: 'done',
          timezone: tz,
        },
        {
          id: randomUUID(),
          userId: alice.id,
          listId: inbox.id,
          habitId: stretchId,
          habitSeq: 1,
          habitKey: `${stretchId}:${today}:1`,
          title: '拉伸',
          status: 'todo',
          timezone: tz,
        },
      ]);

    const listed = await listHabits(alice.id, tz, now);
    const waterRow = listed.find((row) => row.id === waterId);
    const stretchRow = listed.find((row) => row.id === stretchId);
    expect(waterRow).toMatchObject({ todayDone: 1, todayTotal: 1 });
    expect(stretchRow).toMatchObject({ todayDone: 0, todayTotal: 1 });

    const facts = await loadHabitHeadlineFacts(alice.id, tz, now);
    expect(facts.find((row) => row.id === waterId)?.todayDone).toBe(1);
    expect(facts.find((row) => row.id === stretchId)?.todayDone).toBe(0);
  });

  it('does not spawn outside the window', async () => {
    const alice = await registerUser(app);
    await injectJson(app, {
      method: 'POST',
      url: '/api/v1/habits',
      token: alice.token,
      payload: { name: '喝水', kind: 'count', targetCount: 8, windowStart: '08:00', windowEnd: '22:00' },
    });
    const lateNight = new Date('2026-09-09T15:30:00Z'); // 23:30 Asia/Shanghai
    expect(await spawnDailyHabits(alice.id, 'Asia/Shanghai', lateNight)).toBe(0);
  });

  it('relays to the next instance on complete until the target is reached', async () => {
    const alice = await registerUser(app);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/habits',
      token: alice.token,
      payload: { name: '喝水', kind: 'count', targetCount: 2 },
    });
    const habitId = created.json().id as string;
    await spawnDailyHabits(alice.id, 'Asia/Shanghai', new Date());

    const today = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/today',
      token: alice.token,
    });
    const first = today.json().tasks.find((t: { habitId: string | null }) => t.habitId === habitId);
    expect(first.habitSeq).toBe(1);

    const done = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${first.id}/complete`,
      token: alice.token,
      payload: {},
    });
    expect(done.statusCode).toBe(200);

    const after = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/today',
      token: alice.token,
    });
    const second = after
      .json()
      .tasks.find(
        (t: { habitId: string | null; habitSeq: number | null; status: string }) =>
          t.habitId === habitId && t.habitSeq === 2 && t.status !== 'done',
      );
    expect(second).toBeTruthy();

    // Completing seq 2 reaches the target (2): no third instance.
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${second.id}/complete`,
      token: alice.token,
      payload: {},
    });
    const final = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/today',
      token: alice.token,
    });
    const third = final
      .json()
      .tasks.find(
        (t: { habitId: string | null; habitSeq: number | null }) =>
          t.habitId === habitId && t.habitSeq === 3,
      );
    expect(third).toBeUndefined();
  });

  it('ticks a count habit even after the window, until the target', async () => {
    const alice = await registerUser(app);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/habits',
      token: alice.token,
      payload: { name: '喝水', kind: 'count', targetCount: 2, windowStart: '08:00', windowEnd: '22:00' },
    });
    const habitId = created.json().id as string;

    const first = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/habits/${habitId}/tick`,
      token: alice.token,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ id: habitId, todayDone: 1, todayTotal: 1 });

    const second = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/habits/${habitId}/tick`,
      token: alice.token,
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ id: habitId, todayDone: 2, todayTotal: 2 });

    const third = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/habits/${habitId}/tick`,
      token: alice.token,
      payload: {},
    });
    expect(third.statusCode).toBe(200);
    expect(third.json()).toMatchObject({ todayDone: 2, todayTotal: 2 });
  });

  it('links a habit to a thread and rejects a foreign outcome', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const outcome = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/outcomes',
      token: alice.token,
      payload: { name: '身体健康' },
    });
    expect(outcome.statusCode).toBe(200);
    const outcomeId = outcome.json().id as string;
    const foreign = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/outcomes',
      token: bob.token,
      payload: { name: '别人的线程' },
    });
    expect(foreign.statusCode).toBe(200);

    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/habits',
      token: alice.token,
      payload: { name: '锻炼', kind: 'daily', outcomeId },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ name: '锻炼', outcomeId });

    const rejected = await injectJson(app, {
      method: 'PATCH',
      url: `/api/v1/habits/${created.json().id}`,
      token: alice.token,
      payload: { outcomeId: foreign.json().id },
    });
    expect(rejected.statusCode).toBe(404);

    const noon = DateTime.now().setZone('Asia/Shanghai').set({
      hour: 12,
      minute: 0,
      second: 0,
      millisecond: 0,
    }).toJSDate();
    expect(await spawnDailyHabits(alice.id, 'Asia/Shanghai', noon)).toBe(1);
    const today = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/today',
      token: alice.token,
    });
    const instance = today.json().tasks.find((t: { habitId: string | null }) => t.habitId === created.json().id);
    expect(instance).toBeTruthy();
    await injectJson(app, {
      method: 'POST',
      url: `/api/v1/tasks/${instance.id}/complete`,
      token: alice.token,
      payload: {},
    });

    const board = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/today',
      token: alice.token,
    });
    const thread = board.json().outcomes.find((row: { id: string }) => row.id === outcomeId);
    expect(thread.completedLast7d).toBeGreaterThanOrEqual(1);

    const detail = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${outcomeId}/detail`,
      token: alice.token,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().habits).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.json().id, name: '锻炼', outcomeId })]),
    );
    expect(detail.json().tasks.every((task: { habitId: string | null }) => task.habitId === null)).toBe(
      true,
    );
  });

  it('deletes a habit and soft-deletes open instances', async () => {
    const alice = await registerUser(app);
    const created = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/habits',
      token: alice.token,
      payload: { name: '冥想', kind: 'daily' },
    });
    expect(created.statusCode).toBe(200);
    const habitId = created.json().id as string;
    const noon = DateTime.now().setZone('Asia/Shanghai').set({
      hour: 12,
      minute: 0,
      second: 0,
      millisecond: 0,
    }).toJSDate();
    expect(await spawnDailyHabits(alice.id, 'Asia/Shanghai', noon)).toBe(1);
    const before = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/today',
      token: alice.token,
    });
    const instance = before.json().tasks.find((t: { habitId: string | null }) => t.habitId === habitId);
    expect(instance).toBeTruthy();

    const deleted = await injectJson(app, {
      method: 'DELETE',
      url: `/api/v1/habits/${habitId}`,
      token: alice.token,
    });
    expect(deleted.statusCode).toBe(200);

    const after = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/today',
      token: alice.token,
    });
    expect(after.json().tasks.some((t: { id: string }) => t.id === instance.id)).toBe(false);
    const listed = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/habits',
      token: alice.token,
    });
    expect(listed.json().some((habit: { id: string }) => habit.id === habitId)).toBe(false);
    const taskGet = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/tasks/${instance.id}`,
      token: alice.token,
    });
    expect(taskGet.statusCode).toBe(404);
  });
});
