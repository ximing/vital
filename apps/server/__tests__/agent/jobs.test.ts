/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKOFF_MS,
  MAX_ATTEMPTS,
  claimDueJobs,
  enqueueAgentJob,
  finalizeAgentJob,
  enqueueOutcomeRefresh,
  processDueAgentJobs,
  recoverStuckAgentJobs,
} from '../../src/agent/jobs.js';
import { heartbeatAgentJob, LostAgentJobLeaseError, withAgentJobEffects } from '../../src/agent/job-runtime.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentExecutions, agentJobs, agentUsage, outcomes } from '../../src/db/schema.js';
import { setPiResolveOverride } from '../../src/llm/pi.js';
import { resetDb } from '../helpers/db.js';
import { injectJson } from '../helpers/http.js';
import { registerUser } from '../helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterEach(() => {
  setPiResolveOverride(null);
});

afterAll(async () => {
  await app.close();
});

/** Route every resolution to a scriptable faux provider (mirror of llm.flow.test.ts). */
function installFaux(texts: string[]) {
  const faux = fauxProvider({ provider: 'faux', models: [{ id: 'faux-1' }] });
  faux.setResponses(texts.map((t) => fauxAssistantMessage(t)));
  setPiResolveOverride((stored, route, apiKey) => {
    const models = createModels();
    models.setProvider(faux.provider);
    const model = models.getModel('faux', route.model);
    if (!model) return null;
    return { models, model, apiKey, route, stored };
  });
  return faux;
}

async function addFauxProvider(token: string): Promise<string> {
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/llm/providers',
    token,
    payload: {
      providerId: 'custom',
      label: '测试网关',
      baseUrl: 'http://faux.test/v1',
      apiKey: 'sk-secret',
      models: ['faux-1'],
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json().providers[0].id as string;
}

async function routeDefault(token: string, providerId: string): Promise<void> {
  const res = await injectJson(app, {
    method: 'PUT',
    url: '/api/v1/llm/routing',
    token,
    payload: { routing: { default: { providerId, model: 'faux-1' } } },
  });
  expect(res.statusCode).toBe(200);
}

async function createOutcome(token: string, name = '上线 Q3'): Promise<string> {
  const res = await injectJson(app, {
    method: 'POST',
    url: '/api/v1/outcomes',
    token,
    payload: { name },
  });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

async function jobByKey(dedupKey: string) {
  const rows = await getDb().select().from(agentJobs).where(eq(agentJobs.dedupKey, dedupKey));
  return rows;
}

describe('agent jobs queue', () => {
  it('dedup upsert collapses bursts and re-arms terminal jobs', async () => {
    const alice = await registerUser(app);
    const outcomeId = await createOutcome(alice.token);
    const key = `outcome.refresh:${outcomeId}`;

    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });
    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date()); // default +30s
    let rows = await jobByKey(key);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    // The second enqueue re-armed scheduled_at to ~30s out.
    expect(rows[0]!.scheduledAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    // Enqueueing marks the thread as pending.
    const [outcome] = await getDb().select().from(outcomes).where(eq(outcomes.id, outcomeId));
    expect(outcome!.agentState).toBe('pending');

    // No LLM configured → skipped → done.
    const n = await processDueAgentJobs(new Date(Date.now() + 60_000));
    expect(n).toBe(1);
    rows = await jobByKey(key);
    expect(rows[0]!.status).toBe('done');
    expect(rows[0]!.lastError).toBe('skipped:no-llm');

    // Re-trigger re-arms the done job.
    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });
    rows = await jobByKey(key);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending');
    expect(rows[0]!.attemptCount).toBe(0);
  });

  it('claimDueJobs marks rows running and a second claim gets nothing', async () => {
    const alice = await registerUser(app);
    const past = new Date(Date.now() - 1_000);
    await enqueueAgentJob(getDb(), {
      userId: alice.id,
      jobType: 'reflect.daily',
      payload: { date: '2026-09-09' },
      dedupKey: 'reflect.daily:test:2026-09-09',
      scheduledAt: past,
    });
    await enqueueAgentJob(getDb(), {
      userId: alice.id,
      jobType: 'memory.distill',
      payload: { date: '2026-W37' },
      dedupKey: 'memory.distill:test:2026-W37',
      scheduledAt: past,
    });

    const claimed = await claimDueJobs(new Date(), 10);
    expect(claimed).toHaveLength(2);
    expect(claimed.every((j) => j.status === 'running')).toBe(true);
    const again = await claimDueJobs(new Date(), 10);
    expect(again).toHaveLength(0);
  });

  it('backs off on failure and fails terminally at MAX_ATTEMPTS, marking the outcome failed', async () => {
    const alice = await registerUser(app);
    const providerId = await addFauxProvider(alice.token);
    await routeDefault(alice.token, providerId);
    const faux = installFaux([]);
    faux.setResponses(
      Array.from({ length: MAX_ATTEMPTS + 2 }, () =>
        fauxAssistantMessage('boom', { stopReason: 'error', errorMessage: 'provider 5xx' }),
      ),
    );
    const outcomeId = await createOutcome(alice.token);
    const key = `outcome.refresh:${outcomeId}`;
    await enqueueOutcomeRefresh(getDb(), alice.id, outcomeId, new Date(), { delayMs: 0 });

    let cursor = Date.now();
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const now = new Date(cursor);
      const n = await processDueAgentJobs(now);
      expect(n).toBe(1);
      const rows = await jobByKey(key);
      expect(rows).toHaveLength(1);
      const job = rows[0]!;
      expect(job.attemptCount).toBe(i);
      expect(job.lastError).toBe('LLM_UNAVAILABLE');
      if (i < MAX_ATTEMPTS) {
        expect(job.status).toBe('pending');
        const wait = BACKOFF_MS[Math.min(i - 1, BACKOFF_MS.length - 1)]!;
        expect(job.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(now.getTime() + wait);
        expect(job.nextAttemptAt!.getTime()).toBeLessThan(now.getTime() + wait + 10_000);
        cursor = now.getTime() + wait + 1_000;
      } else {
        expect(job.status).toBe('failed');
      }
    }

    const [outcome] = await getDb().select().from(outcomes).where(eq(outcomes.id, outcomeId));
    expect(outcome!.agentState).toBe('failed');
  });

  it('recoverStuckAgentJobs re-arms only expired running leases', async () => {
    const alice = await registerUser(app);
    await enqueueAgentJob(getDb(), {
      userId: alice.id,
      jobType: 'reflect.daily',
      payload: { date: '2026-09-09' },
      dedupKey: 'reflect.daily:stuck:2026-09-09',
      scheduledAt: new Date(Date.now() - 1_000),
    });
    const claimed = await claimDueJobs(new Date(), 10);
    expect(claimed).toHaveLength(1);

    const now = new Date();
    // Fresh running job: untouched.
    expect(await recoverStuckAgentJobs(now)).toBe(0);
    // Age it past the stuck threshold.
    await getDb()
      .update(agentJobs)
      .set({ leaseExpiresAt: new Date(now.getTime() - 1) })
      .where(eq(agentJobs.id, claimed[0]!.id));
    expect(await recoverStuckAgentJobs(now)).toBe(1);
    const rows = await jobByKey('reflect.daily:stuck:2026-09-09');
    expect(rows[0]!.status).toBe('pending');
  });
});

it('preserves a running generation when a new event arrives', async () => {
  const alice = await registerUser(app);
  const input = { userId: alice.id, jobType: 'reflect.daily', payload: { date: '2026-09-09' }, dedupKey: 'generation', scheduledAt: new Date(0) };
  await enqueueAgentJob(getDb(), input);
  const [claimed] = await claimDueJobs(new Date(), 1);
  await enqueueAgentJob(getDb(), { ...input, payload: { date: '2026-09-10' } });
  const [row] = await jobByKey('generation');
  expect(row!.generation).toBe(claimed!.generation + 1);
  expect(row!.claimedGeneration).toBe(claimed!.generation);
  expect(row!.leaseToken).toBe(claimed!.leaseToken);
  expect(row!.status).toBe('running');
});

it('serializes the same user and job type across concurrent claims', async () => {
  const alice = await registerUser(app);
  for (const key of ['one', 'two']) await enqueueAgentJob(getDb(), { userId: alice.id, jobType: 'reflect.daily', payload: { date: key }, dedupKey: key, scheduledAt: new Date(0) });
  const claims = await Promise.all([claimDueJobs(new Date(), 1), claimDueJobs(new Date(), 1)]);
  expect(claims.flat()).toHaveLength(1);
  expect(claims.flat()[0]!.leaseToken).toBeTruthy();
});

it('replays committed effects after a worker crash without writing them twice', async () => {
  const alice = await registerUser(app);
  const outcomeId = await createOutcome(alice.token);
  await enqueueAgentJob(getDb(), { userId: alice.id, jobType: 'outcome.refresh', payload: { outcomeId }, dedupKey: 'effects', scheduledAt: new Date(0) });
  const [old] = await claimDueJobs(new Date(), 1);
  const applied = await withAgentJobEffects(old!, async (tx) => {
    await tx.update(outcomes).set({ agentHeadline: 'first commit' }).where(eq(outcomes.id, outcomeId));
    return { changed: 1 };
  });
  expect(applied).toEqual({ changed: 1 });
  await getDb().update(agentJobs).set({ leaseExpiresAt: new Date(0) }).where(eq(agentJobs.id, old!.id));
  expect(await recoverStuckAgentJobs()).toBe(1);
  const [replacement] = await claimDueJobs(new Date(), 1);
  expect(replacement!.leaseToken).not.toBe(old!.leaseToken);
  const replay = await withAgentJobEffects(replacement!, async (tx) => {
    await tx.update(outcomes).set({ agentHeadline: 'duplicated write' }).where(eq(outcomes.id, outcomeId));
    return { changed: 2 };
  });
  expect(replay).toEqual({ changed: 1 });
  await expect(withAgentJobEffects(old!, () => Promise.resolve('stale'))).rejects.toBeInstanceOf(LostAgentJobLeaseError);
  await finalizeAgentJob(old!, 'done');
  const [running] = await jobByKey('effects');
  expect(running!.status).toBe('running');
  expect(running!.leaseToken).toBe(replacement!.leaseToken);
  const [outcome] = await getDb().select().from(outcomes).where(eq(outcomes.id, outcomeId));
  expect(outcome!.agentHeadline).toBe('first commit');
});

it('finishes the claimed generation and retains newer payload through restart recovery', async () => {
  const alice = await registerUser(app);
  const input = { userId: alice.id, jobType: 'reflect.daily', payload: { date: 'old' }, dedupKey: 'restart', scheduledAt: new Date(0) };
  await enqueueAgentJob(getDb(), input);
  const [old] = await claimDueJobs(new Date(), 1);
  await enqueueAgentJob(getDb(), { ...input, payload: { date: 'new' } });
  await getDb().update(agentJobs).set({ leaseExpiresAt: new Date(0) }).where(eq(agentJobs.id, old!.id));
  await recoverStuckAgentJobs();
  const [recovered] = await claimDueJobs(new Date(), 1);
  expect(recovered!.payload).toEqual({ date: 'old' });
  expect(recovered!.claimedGeneration).toBe(1);
  await withAgentJobEffects(recovered!, () => Promise.resolve('done'));
  await finalizeAgentJob(recovered!, 'done');
  const [pending] = await jobByKey('restart');
  expect(pending!.status).toBe('pending');
  const [next] = await claimDueJobs(new Date(), 1);
  expect(next!.payload).toEqual({ date: 'new' });
  expect(next!.claimedGeneration).toBe(2);
});

it('heartbeat protects a long-running job and an expired owner cannot renew', async () => {
  const alice = await registerUser(app);
  await enqueueAgentJob(getDb(), { userId: alice.id, jobType: 'reflect.daily', payload: { date: 'today' }, dedupKey: 'heartbeat', scheduledAt: new Date(0) });
  const [job] = await claimDueJobs(new Date(), 1);
  const heartbeatAt = new Date(job!.leaseExpiresAt!.getTime() - 1000);
  expect(await heartbeatAgentJob(job!, heartbeatAt)).toBe(true);
  expect(await recoverStuckAgentJobs(new Date(job!.leaseExpiresAt!.getTime() + 1))).toBe(0);
  await getDb().update(agentJobs).set({ leaseExpiresAt: new Date(0) }).where(eq(agentJobs.id, job!.id));
  expect(await heartbeatAgentJob(job!)).toBe(false);
});

it('recovers only execution and usage rows belonging to an expired lease', async () => {
  const alice = await registerUser(app);
  await enqueueAgentJob(getDb(), { userId: alice.id, jobType: 'reflect.daily', payload: { date: 'today' }, dedupKey: 'orphan', scheduledAt: new Date(0) });
  const [job] = await claimDueJobs(new Date(), 1);
  const expiredExecution = randomUUID();
  const healthyExecution = randomUUID();
  await getDb().insert(agentExecutions).values([
    { id: expiredExecution, userId: alice.id, jobId: job!.id, leaseToken: job!.leaseToken, capability: 'reflect', createdAt: new Date(Date.now() - 600_000) },
    { id: healthyExecution, userId: alice.id, capability: 'parse', createdAt: new Date(Date.now() - 600_000) },
  ]);
  const usageId = randomUUID();
  await getDb().insert(agentUsage).values({ id: usageId, userId: alice.id, jobId: job!.id, leaseToken: job!.leaseToken, executionId: expiredExecution, capability: 'reflect', model: 'unknown', status: 'running' });
  expect(await recoverStuckAgentJobs()).toBe(0);
  await getDb().update(agentJobs).set({ leaseExpiresAt: new Date(0) }).where(eq(agentJobs.id, job!.id));
  expect(await recoverStuckAgentJobs()).toBe(1);
  const [expired] = await getDb().select().from(agentExecutions).where(eq(agentExecutions.id, expiredExecution));
  const [healthy] = await getDb().select().from(agentExecutions).where(eq(agentExecutions.id, healthyExecution));
  const [usage] = await getDb().select().from(agentUsage).where(eq(agentUsage.id, usageId));
  expect(expired!.reason).toBe('WORKER_INTERRUPTED');
  expect(healthy!.status).toBe('running');
  expect(usage!.reason).toBe('WORKER_INTERRUPTED_USAGE_UNKNOWN');
  expect(usage!.costMicros).toBeNull();
});

it('does not allow another user to overwrite an existing dedup key', async () => {
  const alice = await registerUser(app);
  const bob = await registerUser(app);
  const input = { userId: alice.id, jobType: 'reflect.daily', payload: { date: 'alice' }, dedupKey: 'owned', scheduledAt: new Date(0) };
  await enqueueAgentJob(getDb(), input);
  expect(await enqueueAgentJob(getDb(), { ...input, userId: bob.id, payload: { date: 'bob' } })).toBeNull();
  const [row] = await jobByKey('owned');
  expect(row!.userId).toBe(alice.id);
  expect(row!.payload).toEqual({ date: 'alice' });
});
