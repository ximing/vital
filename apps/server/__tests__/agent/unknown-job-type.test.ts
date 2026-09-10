/* eslint-disable @typescript-eslint/no-non-null-assertion -- test row assertions */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  enqueueAgentJob,
  processDueAgentJobs,
  UnknownAgentJobTypeError,
} from '../../src/agent/jobs.js';
import { processAgentJob } from '../../src/agent/processors.js';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentJobs } from '../../src/db/schema.js';
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

describe('unknown agent jobType', () => {
  it('processAgentJob throws UnknownAgentJobTypeError for a type the worker does not know', async () => {
    const alice = await registerUser(app);
    // Persisted job: 'habit.spawn' passes the DB check constraint but has no
    // processor, so the rejection must come from the processor switch — not
    // from a foreign-key error on a fabricated job row (the old fake green).
    const id = await enqueueAgentJob(getDb(), {
      userId: alice.id,
      jobType: 'habit.spawn',
      payload: { taskId: alice.id },
      dedupKey: 'test:unknown-type-throw',
      scheduledAt: new Date(),
    });
    expect(id).toBeTruthy();
    const [job] = await getDb().select().from(agentJobs).where(eq(agentJobs.id, id!));

    await expect(processAgentJob(job!, new Date())).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UnknownAgentJobTypeError && err.message.includes('habit.spawn'),
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
    expect(row!.lastError).toBe('UNKNOWN_JOB_TYPE');
    expect(row!.attemptCount).toBe(1);
    expect(row!.nextAttemptAt).toBeNull();
  });
});
