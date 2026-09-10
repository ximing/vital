/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueAgentJob, processDueAgentJobs } from '../../src/agent/jobs.js';
import { processAgentJob } from '../../src/agent/processors.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentJobs, type AgentJobRow } from '../../src/db/schema.js';
import { resetDb } from '../helpers/db.js';
import { registerUser } from '../helpers/session.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildFastify();
});

beforeEach(resetDb);

afterAll(async () => {
  await app.close();
});

function fakeJob(userId: string, jobType: string): AgentJobRow {
  const now = new Date();
  return {
    id: '00000000-0000-0000-0000-000000000001',
    userId,
    jobType,
    payload: { taskId: userId },
    dedupKey: `test:${jobType}`,
    scheduledAt: now,
    status: 'running',
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('unknown agent jobType', () => {
  it('processAgentJob throws for a type the worker does not know', async () => {
    const alice = await registerUser(app);
    await expect(processAgentJob(fakeJob(alice.id, 'future.unknown'), new Date())).rejects.toThrow(
      /future\.unknown/,
    );
  });

  it('processDueAgentJobs marks the job failed (no silent done, no retry)', async () => {
    const alice = await registerUser(app);
    // 'habit.spawn' passes the DB check constraint but has no processor —
    // exactly the old-worker/new-job-type skew that v1.3 hit with task.draft.
    const id = await enqueueAgentJob(getDb(), {
      userId: alice.id,
      jobType: 'habit.spawn',
      payload: { taskId: alice.id },
      dedupKey: 'test:unknown-type',
      scheduledAt: new Date(),
    });
    expect(id).toBeTruthy();
    await processDueAgentJobs(new Date(Date.now() + 5_000));
    const [row] = await getDb().select().from(agentJobs).where(eq(agentJobs.id, id!));
    expect(row!.status).toBe('failed');
    expect(row!.lastError).toContain('habit.spawn');
    expect(row!.attemptCount).toBe(1);
    expect(row!.nextAttemptAt).toBeNull();
  });
});
