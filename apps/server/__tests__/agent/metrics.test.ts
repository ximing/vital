import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentAdoptionDaily } from '../../src/agent/metrics.service.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentActions } from '../../src/db/schema.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

/** Users default to Asia/Shanghai — day buckets follow that zone, so seed in it. */
const TZ = 'Asia/Shanghai';

function atShanghai(daysAgo: number, hour = 12): Date {
  return DateTime.now()
    .setZone(TZ)
    .minus({ days: daysAgo })
    .startOf('day')
    .plus({ hours: hour })
    .toJSDate();
}

async function seedAction(
  userId: string,
  feedback: 'pending' | 'accepted' | 'edited' | 'dismissed' | 'undone',
  createdAt: Date,
): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(agentActions)
    .values({
      id,
      userId,
      actionType: 'task.decompose',
      targetType: 'task',
      targetId: randomUUID(),
      payload: { subtasks: [{ title: '第一步', estimateMinutes: 15 }] },
      feedback,
      createdAt,
    });
  return id;
}

describe('agent adoption metrics', () => {
  it('agentAdoptionDaily buckets by day, excludes pending from the denominator, compares windows', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');

    // Today: 3 adopted (2 accepted + 1 edited), 1 dismissed, 2 pending.
    await seedAction(alice.id, 'accepted', atShanghai(0));
    await seedAction(alice.id, 'accepted', atShanghai(0));
    await seedAction(alice.id, 'edited', atShanghai(0));
    await seedAction(alice.id, 'dismissed', atShanghai(0));
    await seedAction(alice.id, 'pending', atShanghai(0));
    await seedAction(alice.id, 'pending', atShanghai(0));
    // Yesterday: one dismissal only.
    await seedAction(alice.id, 'dismissed', atShanghai(1));
    // Previous window (45 days back, inside [today-60, today-30)): 1 adopted, 1 dismissed.
    await seedAction(alice.id, 'accepted', atShanghai(45));
    await seedAction(alice.id, 'dismissed', atShanghai(45));
    // Outside both windows entirely.
    await seedAction(alice.id, 'accepted', atShanghai(100));
    // Another user's actions never count.
    await seedAction(bob.id, 'accepted', atShanghai(0));

    const result = await agentAdoptionDaily(alice.id, 30, TZ);

    expect(result.daily).toHaveLength(2);
    // Ascending by date; yesterday first.
    const yesterday = result.daily[0];
    const today = result.daily[1];
    expect(yesterday).toMatchObject({
      proposed: 1,
      adopted: 0,
      dismissed: 1,
      adoptionRate: 0,
    });
    expect(yesterday?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Pending counts as proposed but never enters the denominator: 3/4, not 3/6.
    expect(today).toMatchObject({
      proposed: 6,
      adopted: 3,
      dismissed: 1,
      adoptionRate: 0.75,
    });

    expect(result.summary).toEqual({
      proposed: 7,
      adopted: 3,
      dismissed: 2,
      undone: 0,
      adoptionRate: 0.6,
      prevAdoptionRate: 0.5,
    });
  });

  it('undone actions leave adopted and land in their own bucket', async () => {
    const alice = await registerUser(app, 'alice');
    // Today: 1 accepted, 1 undone, 1 dismissed.
    await seedAction(alice.id, 'accepted', atShanghai(0));
    await seedAction(alice.id, 'undone', atShanghai(0));
    await seedAction(alice.id, 'dismissed', atShanghai(0));

    const result = await agentAdoptionDaily(alice.id, 30, TZ);
    const today = result.daily[0];
    expect(today).toMatchObject({
      proposed: 3,
      // undone counts as proposed but neither adopted nor dismissed.
      adopted: 1,
      dismissed: 1,
      undone: 1,
      adoptionRate: 0.5,
    });
    expect(result.summary).toMatchObject({ adopted: 1, dismissed: 1, undone: 1 });
  });

  it('returns zeros when the user has no actions', async () => {
    const alice = await registerUser(app, 'alice');
    const result = await agentAdoptionDaily(alice.id, 30, TZ);
    expect(result.daily).toEqual([]);
    expect(result.summary).toEqual({
      proposed: 0,
      adopted: 0,
      dismissed: 0,
      undone: 0,
      adoptionRate: 0,
      prevAdoptionRate: 0,
    });
  });

  it('GET /agent/metrics returns daily + summary, clamps days, rejects garbage', async () => {
    const alice = await registerUser(app, 'alice');
    await seedAction(alice.id, 'accepted', atShanghai(0));
    await seedAction(alice.id, 'dismissed', atShanghai(0));

    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/metrics?days=500',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.daily).toHaveLength(1);
    expect(body.summary).toEqual({
      proposed: 2,
      adopted: 1,
      dismissed: 1,
      undone: 0,
      adoptionRate: 0.5,
      prevAdoptionRate: 0,
    });

    const defaults = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/metrics',
      token: alice.token,
    });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json().summary.proposed).toBe(2);

    const bad = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/metrics?days=0',
      token: alice.token,
    });
    expect(bad.statusCode).toBe(400);

    const anonymous = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/metrics',
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
