import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { buildFastify } from '../../src/app.js';
import { setContinuityEnabledForTest } from '../../src/continuity/flag.js';
import { getDb } from '../../src/db/index.js';
import {
  continuityContractRevisions,
  continuityContracts,
  continuityEvents,
  outcomes,
} from '../../src/db/schema.js';
import { removeAgentOutcome } from '../../src/outcomes/remove-agent-outcome.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(async () => {
  await resetDb();
  setContinuityEnabledForTest(true);
});

afterEach(() => {
  setContinuityEnabledForTest(null);
});

afterAll(async () => {
  await app.close();
});

async function createOutcome(token: string, name = '英语学习'): Promise<string> {
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/outcomes',
    token,
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

async function countUserRows(
  table: typeof continuityContracts | typeof continuityContractRevisions | typeof continuityEvents,
  userId: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.userId, userId));
  return row?.n ?? 0;
}

describe('continuity', () => {
  it('returns unhosted for a new outcome', async () => {
    const alice = await registerUser(app, 'alice');
    const id = await createOutcome(alice.token);
    const res = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${id}/continuity`,
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hosted: false, contract: null });
  });

  it('PUT draft is draft and does not create tasks', async () => {
    const alice = await registerUser(app, 'alice');
    const id = await createOutcome(alice.token);
    const put = await injectJson(app, {
      method: 'PUT',
      url: `/api/v1/outcomes/${id}/continuity`,
      token: alice.token,
      payload: {},
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().hosted).toBe(false);
    expect(put.json().contract.lifecycle).toBe('draft');
    expect(put.json().contract.cadence).toEqual({
      kind: 'weekly_count',
      count: 2,
      durationMin: 20,
      graceHours: 12,
    });
    expect(put.json().contract.authorization).toEqual({
      readVital: true,
      prepareMaterials: true,
      generateDrafts: true,
      externalSearch: false,
    });
    expect(put.json().contract.timezone).toBe('Asia/Shanghai');
    expect(put.json().contract.weekStartsOn).toBe(1);

    const got = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${id}/continuity`,
      token: alice.token,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().contract.lifecycle).toBe('draft');
    expect(got.json().contract.id).toBe(put.json().contract.id);

    const detail = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${id}/detail`,
      token: alice.token,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().tasks).toEqual([]);
  });

  it('activate is unique per outcome and a second activate returns the same id', async () => {
    const alice = await registerUser(app, 'alice');
    const id = await createOutcome(alice.token);
    const first = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/continuity/activate`,
      token: alice.token,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().hosted).toBe(true);
    expect(first.json().contract.lifecycle).toBe('active');
    const contractId = first.json().contract.id as string;

    const second = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/continuity/activate`,
      token: alice.token,
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().contract.id).toBe(contractId);
    expect(second.json().contract.currentRevision).toBe(first.json().contract.currentRevision);

    const rows = await getDb()
      .select()
      .from(continuityContracts)
      .where(eq(continuityContracts.outcomeId, id));
    expect(rows).toHaveLength(1);

    const events = await getDb()
      .select()
      .from(continuityEvents)
      .where(eq(continuityEvents.aggregateId, contractId));
    expect(events.filter((row) => row.type === 'contract.activated')).toHaveLength(1);

    const detail = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${id}/detail`,
      token: alice.token,
    });
    expect(detail.json().tasks).toEqual([]);
  });

  it('replays the same idempotencyKey', async () => {
    const alice = await registerUser(app, 'alice');
    const id = await createOutcome(alice.token);
    const first = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/continuity/activate`,
      token: alice.token,
      payload: { idempotencyKey: 'act-1' },
    });
    expect(first.statusCode).toBe(200);
    const replay = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/continuity/activate`,
      token: alice.token,
      payload: { idempotencyKey: 'act-1' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const revisions = await getDb()
      .select()
      .from(continuityContractRevisions)
      .where(eq(continuityContractRevisions.userId, alice.id));
    expect(revisions).toHaveLength(1);
  });

  it('returns 404 when another user uses the outcome id', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const id = await createOutcome(alice.token);
    const get = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${id}/continuity`,
      token: bob.token,
    });
    expect(get.statusCode).toBe(404);
    expect(get.json().error.code).toBe('NOT_FOUND');
    const put = await injectJson(app, {
      method: 'PUT',
      url: `/api/v1/outcomes/${id}/continuity`,
      token: bob.token,
      payload: {},
    });
    expect(put.statusCode).toBe(404);
    const activate = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/continuity/activate`,
      token: bob.token,
      payload: {},
    });
    expect(activate.statusCode).toBe(404);
  });

  it('returns 409 CONTINUITY_VERSION_CONFLICT on a stale expectedVersion', async () => {
    const alice = await registerUser(app, 'alice');
    const id = await createOutcome(alice.token);
    const put = await injectJson(app, {
      method: 'PUT',
      url: `/api/v1/outcomes/${id}/continuity`,
      token: alice.token,
      payload: {},
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().contract.currentRevision).toBe(1);
    const stale = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/continuity/activate`,
      token: alice.token,
      payload: { expectedVersion: 0 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONTINUITY_VERSION_CONFLICT');
    expect(stale.json().error.details).toEqual({ currentVersion: 1 });
  });

  it('rejects activate when the flag is off and still allows GET and pause', async () => {
    const alice = await registerUser(app, 'alice');
    const id = await createOutcome(alice.token);
    const activated = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/continuity/activate`,
      token: alice.token,
      payload: {},
    });
    expect(activated.statusCode).toBe(200);
    setContinuityEnabledForTest(false);
    const blocked = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/continuity/activate`,
      token: alice.token,
      payload: { meaning: 'should not write' },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('CONTINUITY_DISABLED');
    const draft = await injectJson(app, {
      method: 'PUT',
      url: `/api/v1/outcomes/${id}/continuity`,
      token: alice.token,
      payload: {},
    });
    expect(draft.statusCode).toBe(403);

    const got = await injectJson(app, {
      method: 'GET',
      url: `/api/v1/outcomes/${id}/continuity`,
      token: alice.token,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json().hosted).toBe(true);
    expect(got.json().contract.lifecycle).toBe('active');

    const paused = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${id}/continuity/pause`,
      token: alice.token,
      payload: {},
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().contract.lifecycle).toBe('paused');
  });

  it('removeAgentOutcome deletes continuity rows for that outcome', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = randomUUID();
    await getDb().insert(outcomes).values({
      id: outcomeId,
      userId: alice.id,
      name: 'Agent 线程',
      createdBy: 'agent',
      undoUntil: new Date(Date.now() + 3600 * 1000),
    });
    const activated = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/continuity/activate`,
      token: alice.token,
      payload: {},
    });
    expect(activated.statusCode).toBe(200);
    expect(await countUserRows(continuityContracts, alice.id)).toBe(1);
    expect(await countUserRows(continuityContractRevisions, alice.id)).toBe(1);
    expect(await countUserRows(continuityEvents, alice.id)).toBe(1);

    await getDb().transaction(async (tx) => {
      const removed = await removeAgentOutcome(tx, alice.id, outcomeId, new Date());
      expect(removed).toBe(true);
    });
    expect(await countUserRows(continuityContracts, alice.id)).toBe(0);
    expect(await countUserRows(continuityContractRevisions, alice.id)).toBe(0);
    expect(await countUserRows(continuityEvents, alice.id)).toBe(0);
  });

  it('settings PUT/GET round-trip and stay hidden from another user', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const put = await injectJson(app, {
      method: 'PUT',
      url: '/api/v1/continuity/settings',
      token: alice.token,
      payload: {
        explorationWeekend: true,
        dailyPushLimit: 4,
        weeklyPushLimit: 7,
        defaultCadence: { kind: 'weekly_count', count: 3, durationMin: 25, graceHours: 12 },
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({
      explorationWeekend: true,
      explorationHoliday: false,
      region: null,
      dailyPushLimit: 4,
      weeklyPushLimit: 7,
    });
    const got = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/continuity/settings',
      token: alice.token,
    });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual(put.json());

    const bobGot = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/continuity/settings',
      token: bob.token,
    });
    expect(bobGot.statusCode).toBe(200);
    expect(bobGot.json()).toEqual({
      explorationWeekend: false,
      explorationHoliday: false,
      region: null,
      externalSearch: false,
      dailyPushLimit: 1,
      weeklyPushLimit: 3,
      defaultCadence: null,
    });
  });
});
