/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dailyUsage, recordUsage } from '../../src/agent/usage.service.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentJobs, agentUsage } from '../../src/db/schema.js';
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

/** Insert a bare job row so usage rows satisfy the job_id FK. */
async function makeJob(userId: string, suffix: string): Promise<string> {
  const now = new Date();
  const [row] = await getDb()
    .insert(agentJobs)
    .values({
      id: crypto.randomUUID(),
      userId,
      jobType: 'reflect.daily',
      payload: { date: '2026-09-09' },
      dedupKey: `usage-test:${suffix}:${crypto.randomUUID()}`,
      scheduledAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: agentJobs.id });
  return row!.id;
}

async function insertUsageRow(
  userId: string,
  jobId: string,
  input: {
    capability: string;
    promptTokens: number;
    completionTokens: number;
    costMicros: number;
    createdAt: Date;
  },
): Promise<void> {
  await getDb().insert(agentUsage).values({
    id: crypto.randomUUID(),
    userId,
    jobId,
    capability: input.capability,
    model: 'faux-1',
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    costMicros: input.costMicros,
    createdAt: input.createdAt,
  });
}

describe('agent usage ledger', () => {
  it('recordUsage persists tokens and micro-USD cost verbatim', async () => {
    const alice = await registerUser(app);
    const jobId = await makeJob(alice.id, 'record');

    await recordUsage(getDb(), {
      userId: alice.id,
      jobId,
      capability: 'headline',
      model: 'gpt-5-mini',
      usage: { promptTokens: 1234, completionTokens: 56, costMicros: 789 },
    });

    const rows = await getDb().select().from(agentUsage).where(eq(agentUsage.userId, alice.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.jobId).toBe(jobId);
    expect(rows[0]!.capability).toBe('headline');
    expect(rows[0]!.model).toBe('gpt-5-mini');
    expect(rows[0]!.promptTokens).toBe(1234);
    expect(rows[0]!.completionTokens).toBe(56);
    expect(rows[0]!.costMicros).toBe(789);
  });

  it('dailyUsage aggregates by day × capability and totals the window', async () => {
    const alice = await registerUser(app);
    const jobId = await makeJob(alice.id, 'daily');
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);

    // Two runs, same day + capability → folded into one row.
    await recordUsage(getDb(), {
      userId: alice.id,
      jobId,
      capability: 'headline',
      model: 'faux-1',
      usage: { promptTokens: 100, completionTokens: 10, costMicros: 5 },
    });
    await recordUsage(getDb(), {
      userId: alice.id,
      jobId,
      capability: 'headline',
      model: 'faux-1',
      usage: { promptTokens: 200, completionTokens: 20, costMicros: 7 },
    });
    await recordUsage(getDb(), {
      userId: alice.id,
      jobId,
      capability: 'critic',
      model: 'faux-1',
      usage: { promptTokens: 400, completionTokens: 40, costMicros: 12 },
    });
    // An older in-window day and an out-of-window row.
    await insertUsageRow(alice.id, jobId, {
      capability: 'decompose',
      promptTokens: 1000,
      completionTokens: 100,
      costMicros: 50,
      createdAt: yesterday,
    });
    await insertUsageRow(alice.id, jobId, {
      capability: 'distill',
      promptTokens: 9999,
      completionTokens: 999,
      costMicros: 999,
      createdAt: new Date(now.getTime() - 45 * 24 * 3600 * 1000),
    });

    const summary = await dailyUsage(alice.id, 30, 'UTC');

    expect(summary.days).toBe(30);
    expect(summary.items).toHaveLength(3);
    // Ascending by date, then capability.
    expect(summary.items[0]!.capability).toBe('decompose');
    expect(summary.items[0]!.runs).toBe(1);
    expect(summary.items[0]!.promptTokens).toBe(1000);
    expect(summary.items[1]!.capability).toBe('critic');
    expect(summary.items[2]!.capability).toBe('headline');
    expect(summary.items[2]!.runs).toBe(2);
    expect(summary.items[2]!.promptTokens).toBe(300);
    expect(summary.items[2]!.completionTokens).toBe(30);
    expect(summary.items[2]!.costMicros).toBe(12);

    // The 45-day-old row is outside the window and never counted.
    expect(summary.totalRuns).toBe(4);
    expect(summary.totalPromptTokens).toBe(1700);
    expect(summary.totalCompletionTokens).toBe(170);
    expect(summary.totalCostMicros).toBe(74);
  });

  it('GET /agent/usage returns the summary and clamps days to 90', async () => {
    const alice = await registerUser(app);
    const jobId = await makeJob(alice.id, 'route');
    await recordUsage(getDb(), {
      userId: alice.id,
      jobId,
      capability: 'parse',
      model: 'faux-1',
      usage: { promptTokens: 42, completionTokens: 7, costMicros: 3 },
    });

    const res = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/usage?days=500',
      token: alice.token,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toBe(90);
    expect(body.totalRuns).toBe(1);
    expect(body.totalPromptTokens).toBe(42);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].capability).toBe('parse');
    expect(body.items[0].costMicros).toBe(3);

    const bad = await injectJson(app, {
      method: 'GET',
      url: '/api/v1/agent/usage?days=0',
      token: alice.token,
    });
    expect(bad.statusCode).toBe(400);
  });
});
