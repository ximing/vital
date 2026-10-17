import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../src/app.js';
import { resetDb } from './helpers/db.js';
import { injectJson } from './helpers/http.js';
import { registerUser } from './helpers/session.js';

const ZONE = 'Asia/Shanghai';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

function ymd(daysAgo = 0): string {
  const day = DateTime.now().setZone(ZONE).minus({ days: daysAgo }).toISODate();
  if (!day) throw new Error('invalid day');
  return day;
}

function at(daysAgo: number, hour: number): string {
  const instant = DateTime.now()
    .setZone(ZONE)
    .minus({ days: daysAgo })
    .startOf('day')
    .plus({ hours: hour });
  const iso = instant.toISO();
  if (!iso) throw new Error('invalid instant');
  return iso;
}

describe('energy logs', () => {
  it('requires auth', async () => {
    const res = await injectJson(app, { method: 'GET', url: '/api/v1/energy-logs' });
    expect(res.statusCode).toBe(401);
  });

  it('stores several logs on one day and hides them from another user and another day', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/energy-logs',
      token: alice.token,
      payload: { energy: 2, mood: '疲惫', note: 'P10验收 低精力' },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ energy: 2, mood: '疲惫', note: 'P10验收 低精力' });

    const second = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/energy-logs',
      token: alice.token,
      payload: { energy: 4, mood: '  ', note: '' },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().mood).toBeNull();
    expect(second.json().note).toBeNull();
    expect(second.json().createdAt > first.json().createdAt).toBe(true);

    const yesterday = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/energy-logs',
      token: alice.token,
      payload: { energy: 1, loggedAt: at(1, 21), note: 'P10验收 昨天' },
    });
    expect(yesterday.statusCode).toBe(201);

    const today = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/energy-logs?date=${ymd()}`,
      token: alice.token,
    });
    expect(today.statusCode).toBe(200);
    const todayItems = today.json().items as { id: string; energy: number; note: string | null }[];
    expect(todayItems.map((item) => item.energy).sort()).toEqual([2, 4]);

    const prior = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/energy-logs?date=${ymd(1)}`,
      token: alice.token,
    });
    expect(prior.json().items).toHaveLength(1);
    expect(prior.json().items[0].note).toBe('P10验收 昨天');

    const hidden = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/energy-logs?date=${ymd()}`,
      token: bob.token,
    });
    expect(hidden.json().items).toEqual([]);

    const bad = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/energy-logs',
      token: alice.token,
      payload: { energy: 6 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');

    const future = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/energy-logs',
      token: alice.token,
      payload: { energy: 3, loggedAt: DateTime.now().plus({ days: 2 }).toISO() },
    });
    expect(future.statusCode).toBe(400);

    const since = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/energy-logs?date=${ymd()}&since=${encodeURIComponent(first.json().createdAt as string)}`,
      token: alice.token,
    });
    expect(since.statusCode).toBe(200);
    const sinceItems = since.json().items as { energy: number }[];
    expect(sinceItems.map((item) => item.energy)).toEqual([4]);
  });
});
