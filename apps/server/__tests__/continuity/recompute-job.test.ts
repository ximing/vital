/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { claimDueJobs, processDueAgentJobs } from '../../src/agent/jobs.js';
import { LostAgentJobLeaseError } from '../../src/agent/job-runtime.js';
import { runAgentScheduler } from '../../src/agent/scheduler.js';
import { buildFastify } from '../../src/app.js';
import { setContinuityEnabledForTest } from '../../src/continuity/flag.js';
import {
  CONTINUITY_RECOMPUTE_JOB_TYPE,
  continuityModelEvalDedupKey,
  continuityRecomputeDedupKey,
  processContinuityRecompute,
  tryReserveDailyModelEval,
} from '../../src/continuity/recompute-job.js';
import { getDb } from '../../src/db/index.js';
import {
  agentJobs,
  continuityContracts,
  continuityEvents,
  continuityOpportunities,
  users,
} from '../../src/db/schema.js';
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

async function activate(token: string, outcomeId: string) {
  const res = await injectJson(app, {
    method: 'POST',
    url: `/api/v1/outcomes/${outcomeId}/continuity/activate`,
    token,
    payload: {},
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { hosted: boolean; contract: { id: string } };
}

function windowIdentity(rows: { revision: number; windowKey: string }[]): string[] {
  return rows.map((row) => `${String(row.revision)}:${row.windowKey}`).sort();
}

describe('continuity.recompute', () => {
  it('activate then worker writes opportunities, next_check_at, and processed events', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token);
    const body = await activate(alice.token, outcomeId);
    const contractId = body.contract.id;

    const pending = await getDb()
      .select()
      .from(agentJobs)
      .where(
        and(eq(agentJobs.userId, alice.id), eq(agentJobs.jobType, CONTINUITY_RECOMPUTE_JOB_TYPE)),
      );
    expect(pending).toHaveLength(1);
    expect(pending[0]!.dedupKey).toBe(continuityRecomputeDedupKey(contractId));
    expect(pending[0]!.payload).toMatchObject({ contractId });

    expect(await processDueAgentJobs(new Date(Date.now() + 5_000))).toBe(1);

    const windows = await getDb()
      .select()
      .from(continuityOpportunities)
      .where(eq(continuityOpportunities.contractId, contractId));
    expect(windows.length).toBeGreaterThan(0);
    expect(new Set(windowIdentity(windows)).size).toBe(windows.length);

    const [contract] = await getDb()
      .select()
      .from(continuityContracts)
      .where(eq(continuityContracts.id, contractId));
    expect(contract!.nextCheckAt).not.toBeNull();
    expect(contract!.judgement).toBeTruthy();

    const unprocessed = await getDb()
      .select()
      .from(continuityEvents)
      .where(and(eq(continuityEvents.aggregateId, contractId), isNull(continuityEvents.processedAt)));
    expect(unprocessed).toHaveLength(0);
  });

  it('a second processDueAgentJobs does not duplicate windowKey rows', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token);
    const { contract } = await activate(alice.token, outcomeId);
    await processDueAgentJobs(new Date(Date.now() + 5_000));

    const first = await getDb()
      .select()
      .from(continuityOpportunities)
      .where(eq(continuityOpportunities.contractId, contract.id));
    expect(first.length).toBeGreaterThan(0);

    await processDueAgentJobs(new Date(Date.now() + 5_000));
    const second = await getDb()
      .select()
      .from(continuityOpportunities)
      .where(eq(continuityOpportunities.contractId, contract.id));
    expect(windowIdentity(second)).toEqual(windowIdentity(first));
    expect(second).toHaveLength(first.length);

    const [dup] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(agentJobs)
      .where(
        and(eq(agentJobs.userId, alice.id), eq(agentJobs.jobType, CONTINUITY_RECOMPUTE_JOB_TYPE)),
      );
    expect(dup!.n).toBe(1);
  });

  it('re-runs unprocessed events without duplicating windows', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token);
    const { contract } = await activate(alice.token, outcomeId);
    await processDueAgentJobs(new Date(Date.now() + 5_000));

    const first = await getDb()
      .select()
      .from(continuityOpportunities)
      .where(eq(continuityOpportunities.contractId, contract.id));

    await getDb()
      .update(continuityEvents)
      .set({ processedAt: null })
      .where(eq(continuityEvents.aggregateId, contract.id));

    const { enqueueContinuityRecompute } = await import('../../src/continuity/recompute-job.js');
    await enqueueContinuityRecompute(getDb(), alice.id, contract.id, new Date());
    await processDueAgentJobs(new Date(Date.now() + 5_000));

    const again = await getDb()
      .select()
      .from(continuityOpportunities)
      .where(eq(continuityOpportunities.contractId, contract.id));
    expect(windowIdentity(again)).toEqual(windowIdentity(first));
    const unprocessed = await getDb()
      .select()
      .from(continuityEvents)
      .where(and(eq(continuityEvents.aggregateId, contract.id), isNull(continuityEvents.processedAt)));
    expect(unprocessed).toHaveLength(0);
  });

  it('pause exempts overlapping future windows and resume does not duplicate them', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token);
    const { contract } = await activate(alice.token, outcomeId);
    await processDueAgentJobs(new Date(Date.now() + 5_000));

    const until = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const paused = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/continuity/pause`,
      token: alice.token,
      payload: { until },
    });
    expect(paused.statusCode).toBe(200);
    await processDueAgentJobs(new Date(Date.now() + 5_000));

    const afterPause = await getDb()
      .select()
      .from(continuityOpportunities)
      .where(eq(continuityOpportunities.contractId, contract.id));
    expect(afterPause.some((row) => row.status === 'exempt' && row.exemptReason === 'paused')).toBe(
      true,
    );

    const resumed = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/continuity/resume`,
      token: alice.token,
      payload: {},
    });
    expect(resumed.statusCode).toBe(200);
    await processDueAgentJobs(new Date(Date.now() + 5_000));

    const afterResume = await getDb()
      .select()
      .from(continuityOpportunities)
      .where(eq(continuityOpportunities.contractId, contract.id));
    expect(new Set(windowIdentity(afterResume)).size).toBe(afterResume.length);
    expect(windowIdentity(afterResume)).toEqual(windowIdentity(afterPause));
  });

  it('expired lease does not write judgement', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token);
    const { contract } = await activate(alice.token, outcomeId);
    const [claimed] = await claimDueJobs(new Date(Date.now() + 5_000), 1);
    expect(claimed).toBeTruthy();
    await getDb()
      .update(agentJobs)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(agentJobs.id, claimed!.id));

    const [user] = await getDb().select().from(users).where(eq(users.id, alice.id)).limit(1);
    await expect(processContinuityRecompute(claimed!, user!, new Date())).rejects.toBeInstanceOf(
      LostAgentJobLeaseError,
    );

    const [row] = await getDb()
      .select()
      .from(continuityContracts)
      .where(eq(continuityContracts.id, contract.id));
    expect(row!.judgement).toBeNull();
    const windows = await getDb()
      .select()
      .from(continuityOpportunities)
      .where(eq(continuityOpportunities.contractId, contract.id));
    expect(windows).toHaveLength(0);
  });

  it('flag off still enqueues pause recompute and does not enqueue activate model eval', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token);
    const { contract } = await activate(alice.token, outcomeId);
    setContinuityEnabledForTest(false);

    const denied = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/continuity/activate`,
      token: alice.token,
      payload: {},
    });
    expect(denied.statusCode).toBe(403);

    const paused = await injectJson(app, {
      method: 'POST',
      url: `/api/v1/outcomes/${outcomeId}/continuity/pause`,
      token: alice.token,
      payload: {},
    });
    expect(paused.statusCode).toBe(200);

    const jobs = await getDb()
      .select()
      .from(agentJobs)
      .where(
        and(eq(agentJobs.userId, alice.id), eq(agentJobs.jobType, CONTINUITY_RECOMPUTE_JOB_TYPE)),
      );
    expect(jobs.some((row) => row.dedupKey === continuityRecomputeDedupKey(contract.id))).toBe(true);
    expect(jobs.some((row) => row.dedupKey.startsWith('continuity.model:'))).toBe(false);
  });

  it('scheduler enqueues active contracts with a null next_check_at', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token);
    const { contract } = await activate(alice.token, outcomeId);
    await getDb()
      .delete(agentJobs)
      .where(eq(agentJobs.dedupKey, continuityRecomputeDedupKey(contract.id)));

    await runAgentScheduler(new Date());
    const [job] = await getDb()
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.dedupKey, continuityRecomputeDedupKey(contract.id)));
    expect(job).toBeTruthy();
    expect(job!.status).toBe('pending');
  });

  it('tryReserveDailyModelEval occupies the day once', async () => {
    const alice = await registerUser(app, 'alice');
    const outcomeId = await createOutcome(alice.token);
    const { contract } = await activate(alice.token, outcomeId);
    const now = new Date();
    const ymd = '2026-10-30';
    expect(await tryReserveDailyModelEval(getDb(), alice.id, contract.id, ymd, now)).toBe(true);
    expect(await tryReserveDailyModelEval(getDb(), alice.id, contract.id, ymd, now)).toBe(false);
    const [row] = await getDb()
      .select()
      .from(agentJobs)
      .where(eq(agentJobs.dedupKey, continuityModelEvalDedupKey(contract.id, ymd)));
    expect(row).toBeTruthy();
  });
});
