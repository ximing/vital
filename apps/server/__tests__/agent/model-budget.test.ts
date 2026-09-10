import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { reserveBackgroundModelCall } from '../../src/agent/model-budget.js';
import { resetDb } from '../helpers/db.js';
import { registerUser } from '../helpers/session.js';

let app: FastifyInstance;
beforeAll(async () => { app = await buildFastify(); });
beforeEach(resetDb);
afterAll(async () => app.close());

describe('durable per-user model budget', () => {
  it('atomically reserves capacity across concurrent workers and isolates users', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const now = new Date('2026-09-10T10:00:00Z');
    const reserve = (id: string, at = now) => getDb().transaction((tx) => reserveBackgroundModelCall(tx, id, at, 2));
    const results = await Promise.allSettled([reserve(alice.id), reserve(alice.id), reserve(alice.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { reason: 'DAILY_MODEL_BUDGET' } });
    await expect(reserve(bob.id)).resolves.toBeUndefined();
    // No in-memory reset: a fresh transaction sees the persisted reservation.
    await expect(reserve(alice.id)).rejects.toMatchObject({ reason: 'DAILY_MODEL_BUDGET' });
    await expect(reserve(alice.id, new Date('2026-09-11T10:00:00Z'))).resolves.toBeUndefined();
  });

  it('rolls the reservation back if request bookkeeping cannot commit', async () => {
    const alice = await registerUser(app);
    const now = new Date();
    await expect(getDb().transaction(async (tx) => {
      await reserveBackgroundModelCall(tx, alice.id, now, 1);
      throw new Error('bookkeeping failed');
    })).rejects.toThrow('bookkeeping failed');
    await expect(getDb().transaction((tx) => reserveBackgroundModelCall(tx, alice.id, now, 1))).resolves.toBeUndefined();
  });
});
