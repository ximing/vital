import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentAdoptionDaily } from '../../src/agent/metrics.service.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentUsage } from '../../src/db/schema.js';
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
  actionType: 'task.decompose' | 'outcome.headline' | 'outcome.suggestion' | 'outcome.create' | 'task.draft' = 'task.decompose',
): Promise<string> {
  const id = randomUUID();
  await getDb()
    .insert(agentActions)
    .values({
      id,
      userId,
      actionType,
      targetType: actionType.startsWith('outcome') ? 'outcome' : 'task',
      targetId: randomUUID(),
      payload: { subtasks: [{ title: '第一步', estimateMinutes: 15 }] },
      feedback,
      createdAt,
    });
  return id;
}

async function seedUsage(
  userId: string,
  capability: string,
  costMicros: number | null,
  createdAt: Date,
): Promise<void> {
  await getDb().insert(agentUsage).values({
    id: randomUUID(),
    userId,
    capability,
    model: 'faux-1',
    promptTokens: 100,
    completionTokens: 50,
    costMicros,
    createdAt,
  });
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
      // All seeded actions are task.decompose → a single row, no usage cost recorded.
      perCapability: [
        { capability: 'decompose', costMicros: 0, adopted: 3, costPerAdoptedMicros: 0 },
      ],
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
      perCapability: [],
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
      perCapability: [
        { capability: 'decompose', costMicros: 0, adopted: 1, costPerAdoptedMicros: 0 },
      ],
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

describe('per-capability effective cost', () => {
  it('amortizes one headline run cost over its two adopted proposals', async () => {
    const alice = await registerUser(app, 'alice');
    // One headline run: 600 micros of usage, two actions (headline + suggestion), both adopted.
    await seedUsage(alice.id, 'headline', 600, atShanghai(0));
    await seedAction(alice.id, 'accepted', atShanghai(0), 'outcome.headline');
    await seedAction(alice.id, 'edited', atShanghai(0), 'outcome.suggestion');

    const result = await agentAdoptionDaily(alice.id, 30, TZ);
    expect(result.summary.perCapability).toEqual([
      { capability: 'headline', costMicros: 600, adopted: 2, costPerAdoptedMicros: 300 },
    ]);
  });

  it('returns null costPerAdopted when the capability has no adoptions in the window', async () => {
    const alice = await registerUser(app, 'alice');
    await seedUsage(alice.id, 'cluster', 900, atShanghai(0));
    await seedAction(alice.id, 'dismissed', atShanghai(0), 'outcome.create');

    const result = await agentAdoptionDaily(alice.id, 30, TZ);
    expect(result.summary.perCapability).toEqual([
      { capability: 'cluster', costMicros: 900, adopted: 0, costPerAdoptedMicros: null },
    ]);
  });

  it('undone actions never count as adopted', async () => {
    const alice = await registerUser(app, 'alice');
    await seedUsage(alice.id, 'decompose', 300, atShanghai(0));
    await seedAction(alice.id, 'undone', atShanghai(0), 'task.decompose');

    const result = await agentAdoptionDaily(alice.id, 30, TZ);
    expect(result.summary.perCapability).toEqual([
      { capability: 'decompose', costMicros: 300, adopted: 0, costPerAdoptedMicros: null },
    ]);
  });

  it('sums cost across runs (including null-cost rows) and isolates users', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    await seedUsage(alice.id, 'draft', 100, atShanghai(0));
    await seedUsage(alice.id, 'draft', null, atShanghai(1)); // unknown price: coalesces to 0
    await seedUsage(bob.id, 'draft', 999_999, atShanghai(0));
    await seedAction(alice.id, 'accepted', atShanghai(0), 'task.draft');

    const result = await agentAdoptionDaily(alice.id, 30, TZ);
    expect(result.summary.perCapability).toEqual([
      { capability: 'draft', costMicros: 100, adopted: 1, costPerAdoptedMicros: 100 },
    ]);
  });

  it('shares the daily window: rows outside the window never count', async () => {
    const alice = await registerUser(app, 'alice');
    await seedUsage(alice.id, 'headline', 600, atShanghai(35)); // outside days=30
    await seedAction(alice.id, 'accepted', atShanghai(35), 'outcome.headline');
    await seedUsage(alice.id, 'cluster', 200, atShanghai(0)); // inside

    const result = await agentAdoptionDaily(alice.id, 30, TZ);
    expect(result.summary.perCapability).toEqual([
      { capability: 'cluster', costMicros: 200, adopted: 0, costPerAdoptedMicros: null },
    ]);
  });

  it('ignores capabilities without a proposal mapping (critic, distill, parse)', async () => {
    const alice = await registerUser(app, 'alice');
    await seedUsage(alice.id, 'critic', 150, atShanghai(0));
    await seedUsage(alice.id, 'distill', 150, atShanghai(0));

    const result = await agentAdoptionDaily(alice.id, 30, TZ);
    expect(result.summary.perCapability).toEqual([]);
  });
});
