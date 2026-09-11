import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { finishAgentSchedule, markAgentSchedule } from '../../src/agent/scheduling.js';
import { getDb } from '../../src/db/index.js';
import { agentScheduling } from '../../src/db/schema.js';
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

// Status derivation compares against the real request clock, so seed relative to it.
const NOW = new Date();
const FUTURE = new Date(+NOW + 60_000);
const PAST = new Date(+NOW - 60_000);

interface SeedOverrides {
  generation?: number;
  processedGeneration?: number;
  pendingCount?: number;
  urgent?: boolean;
  pendingSince?: Date | null;
  dueAt?: Date | null;
  cooldownUntil?: Date | null;
  lastSucceededAt?: Date | null;
  observedAt?: Date | null;
}

async function seedRow(userId: string, capability: string, o: SeedOverrides = {}): Promise<void> {
  await getDb().insert(agentScheduling).values({
    userId,
    capability,
    generation: o.generation ?? 2,
    processedGeneration: o.processedGeneration ?? 0,
    pendingCount: o.pendingCount ?? 2,
    urgent: o.urgent ?? false,
    pendingSince: o.pendingSince === undefined ? NOW : o.pendingSince,
    dueAt: o.dueAt === undefined ? FUTURE : o.dueAt,
    cooldownUntil: o.cooldownUntil ?? null,
    lastSucceededAt: o.lastSucceededAt === undefined ? PAST : o.lastSucceededAt,
    observedAt: o.observedAt === undefined ? NOW : o.observedAt,
    updatedAt: NOW,
  });
}

describe('GET /api/v1/agent/schedule', () => {
  it('synthesizes idle rows for capabilities without state and passes fields through', async () => {
    const user = await registerUser(app);
    await seedRow(user.id, 'memory.distill', {
      generation: 3,
      processedGeneration: 3,
      pendingCount: 0,
      pendingSince: null,
      dueAt: null,
      cooldownUntil: PAST,
      lastSucceededAt: PAST,
    });

    const res = await injectJson(app, { method: 'GET', url: '/api/v1/agent/schedule', token: user.token });
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items).toHaveLength(2);
    expect(items.find((i: { capability: string }) => i.capability === 'outcome.cluster')).toEqual({
      capability: 'outcome.cluster',
      generation: 0,
      processedGeneration: 0,
      pendingCount: 0,
      urgent: false,
      pendingSince: null,
      dueAt: null,
      cooldownUntil: null,
      lastSucceededAt: null,
      observedAt: null,
      updatedAt: expect.any(String),
      status: 'idle',
    });
    expect(items.find((i: { capability: string }) => i.capability === 'memory.distill')).toMatchObject({
      generation: 3,
      processedGeneration: 3,
      pendingCount: 0,
      dueAt: null,
      lastSucceededAt: PAST.toISOString(),
      status: 'idle',
    });
  });

  it('derives waiting / due / cooldown and isolates users', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    await seedRow(alice.id, 'outcome.cluster', { dueAt: FUTURE }); // waiting
    await seedRow(alice.id, 'memory.distill', { dueAt: PAST }); // due
    await seedRow(bob.id, 'memory.distill', { dueAt: PAST }); // another user — never visible

    const res = await injectJson(app, { method: 'GET', url: '/api/v1/agent/schedule', token: alice.token });
    const items = res.json().items;
    expect(items.find((i: { capability: string }) => i.capability === 'outcome.cluster')).toMatchObject({ status: 'waiting', pendingCount: 2 });
    expect(items.find((i: { capability: string }) => i.capability === 'memory.distill')).toMatchObject({ status: 'due' });
  });

  it('cooldown applies only without a dueAt (priority lock: due beats cooldown)', async () => {
    const alice = await registerUser(app, 'alice');
    // dueAt in the past AND cooldown active → 'due' wins per the locked order idle → waiting → due → cooldown.
    await seedRow(alice.id, 'outcome.cluster', { dueAt: PAST, cooldownUntil: FUTURE });
    // No dueAt but an active cooldown → 'cooldown'.
    await seedRow(alice.id, 'memory.distill', { dueAt: null, cooldownUntil: FUTURE });

    const res = await injectJson(app, { method: 'GET', url: '/api/v1/agent/schedule', token: alice.token });
    const items = res.json().items;
    expect(items.find((i: { capability: string }) => i.capability === 'outcome.cluster')).toMatchObject({ status: 'due' });
    expect(items.find((i: { capability: string }) => i.capability === 'memory.distill')).toMatchObject({ status: 'cooldown' });
  });

  it('treats a consumed generation as idle even when pendingCount is stale', async () => {
    const alice = await registerUser(app, 'alice');
    await seedRow(alice.id, 'memory.distill', { generation: 2, processedGeneration: 2, pendingCount: 5, dueAt: PAST });

    const res = await injectJson(app, { method: 'GET', url: '/api/v1/agent/schedule', token: alice.token });
    expect(res.json().items.find((i: { capability: string }) => i.capability === 'memory.distill')).toMatchObject({ status: 'idle' });
  });

  it('rejects anonymous access', async () => {
    const res = await injectJson(app, { method: 'GET', url: '/api/v1/agent/schedule' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/agent/schedule/:capability/cancel', () => {
  it('consumes accumulated observations; later activity re-accumulates', async () => {
    const user = await registerUser(app);
    await getDb().transaction((tx) => markAgentSchedule(tx, user.id, 'memory.distill', { now: NOW, urgent: true }));
    await getDb().transaction((tx) => markAgentSchedule(tx, user.id, 'memory.distill', { now: NOW }));

    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/schedule/memory.distill/cancel',
      token: user.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      capability: 'memory.distill',
      generation: 2,
      processedGeneration: 2,
      pendingCount: 0,
      urgent: false,
      pendingSince: null,
      dueAt: null,
      status: 'idle',
    });

    const [row] = await getDb().select().from(agentScheduling).where(eq(agentScheduling.userId, user.id));
    expect(row?.cooldownUntil).toBeNull(); // cancel never claims success — no cooldown is written
    expect(row?.lastSucceededAt).toBeNull();

    // New activity marks again on top of the consumed generation.
    await getDb().transaction((tx) => markAgentSchedule(tx, user.id, 'memory.distill', { now: NOW }));
    const after = await getDb().select().from(agentScheduling).where(eq(agentScheduling.userId, user.id));
    expect(after[0]).toMatchObject({ generation: 3, processedGeneration: 2, pendingCount: 1, urgent: false });

    const view = await injectJson(app, { method: 'GET', url: '/api/v1/agent/schedule', token: user.token });
    expect(view.json().items.find((i: { capability: string }) => i.capability === 'memory.distill')).toMatchObject({ status: 'waiting', pendingCount: 1 });
  });

  it('is idempotent when nothing is pending, and synthesizes idle when no row exists', async () => {
    const user = await registerUser(app);
    // No row at all → synthesized idle item, no error.
    const first = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/schedule/outcome.cluster/cancel',
      token: user.token,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ capability: 'outcome.cluster', status: 'idle', pendingCount: 0 });

    // An already-consumed row → same result, still 200.
    await seedRow(user.id, 'memory.distill', { generation: 2, processedGeneration: 2, pendingCount: 0, pendingSince: null, dueAt: null });
    const second = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/schedule/memory.distill/cancel',
      token: user.token,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ capability: 'memory.distill', status: 'idle', pendingCount: 0 });
  });

  it('404s for a capability outside the scheduling enum', async () => {
    const user = await registerUser(app);
    // URL-encoded dots decode to the real capability and are legitimately accepted.
    for (const capability of ['task.draft', 'nonsense']) {
      const res = await injectJson(app, {
        method: 'POST',
        url: `/api/v1/agent/schedule/${capability}/cancel`,
        token: user.token,
      });
      expect(res.statusCode, capability).toBe(404);
    }
  });

  it('a late finishAgentSchedule after cancel does not destroy newer marks', async () => {
    const user = await registerUser(app);
    await getDb().transaction((tx) => markAgentSchedule(tx, user.id, 'memory.distill', { now: NOW }));
    await getDb().transaction((tx) => markAgentSchedule(tx, user.id, 'memory.distill', { now: NOW }));
    // User cancels while a job dispatched at generation 2 is still in flight…
    await injectJson(app, { method: 'POST', url: '/api/v1/agent/schedule/memory.distill/cancel', token: user.token });
    // …new observations arrive…
    await getDb().transaction((tx) => markAgentSchedule(tx, user.id, 'memory.distill', { now: NOW, urgent: true }));
    // …and the stale job's finish lands last.
    await getDb().transaction((tx) => finishAgentSchedule(tx, user.id, 'memory.distill', 2, NOW));

    const [row] = await getDb().select().from(agentScheduling).where(eq(agentScheduling.userId, user.id));
    // The finish consumed its own snapshot (processed 2) but the newer mark survives.
    expect(row).toMatchObject({ generation: 3, processedGeneration: 2, pendingCount: 1, urgent: true });
  });

  it('cancel keeps another user scheduling untouched', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    await getDb().transaction((tx) => markAgentSchedule(tx, alice.id, 'memory.distill', { now: NOW }));
    await seedRow(bob.id, 'memory.distill');

    const res = await injectJson(app, {
      method: 'POST',
      url: '/api/v1/agent/schedule/memory.distill/cancel',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const rows = await getDb().select().from(agentScheduling).where(eq(agentScheduling.capability, 'memory.distill'));
    const bobRow = rows.find((row) => row.userId === bob.id);
    expect(bobRow).toMatchObject({ generation: 2, pendingCount: 2 });
  });
});
