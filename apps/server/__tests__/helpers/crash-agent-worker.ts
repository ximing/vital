// Launched only by restart.test.ts against the isolated test database.
import { eq } from 'drizzle-orm';
import { claimDueJobs } from '../../src/agent/jobs.js';
import { withAgentJobEffects } from '../../src/agent/job-runtime.js';
import { outcomes } from '../../src/db/schema.js';

if (process.env.NODE_ENV !== 'test') throw new Error('test worker requires test environment');
const [job] = await claimDueJobs(new Date(), 1);
if (!job || !('outcomeId' in job.payload)) throw new Error('expected a queued outcome');
const outcomeId = job.payload.outcomeId;
await withAgentJobEffects(job, async (tx) => {
  await tx.update(outcomes).set({ agentHeadline: 'committed before crash' }).where(eq(outcomes.id, outcomeId));
  return { changed: 1 };
});
process.stdout.write('COMMITTED\n');
// Parent kills us without finalizing the job or closing the connection pool.
setInterval(() => {}, 1000);
