import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { spawnDailyHabits } from '../src/habits/habits.service.js';
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
});
