/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKOFF_MS,
  MAX_ATTEMPTS,
  claimDueJobs,
  enqueueAgentJob,
  enqueueOutcomeRefresh,
  processDueAgentJobs,
  recoverStuckAgentJobs,
} from '../../src/agent/jobs.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentJobs, outcomes } from '../../src/db/schema.js';
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
      expect(job.lastError).toContain('provider 5xx');
      if (i < MAX_ATTEMPTS) {
        expect(job.status).toBe('pending');
        const wait = BACKOFF_MS[Math.min(i - 1, BACKOFF_MS.length - 1)]!;
        expect(job.nextAttemptAt!.getTime()).toBe(now.getTime() + wait);
        cursor = now.getTime() + wait + 1_000;
      } else {
        expect(job.status).toBe('failed');
      }
    }

    const [outcome] = await getDb().select().from(outcomes).where(eq(outcomes.id, outcomeId));
    expect(outcome!.agentState).toBe('failed');
  });

  it('recoverStuckAgentJobs re-arms running jobs older than 5 minutes', async () => {
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
      .set({ updatedAt: new Date(now.getTime() - 10 * 60_000) })
      .where(eq(agentJobs.id, claimed[0]!.id));
    expect(await recoverStuckAgentJobs(now)).toBe(1);
    const rows = await jobByKey('reflect.daily:stuck:2026-09-09');
    expect(rows[0]!.status).toBe('pending');
  });
});
