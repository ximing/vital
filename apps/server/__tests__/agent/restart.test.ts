import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildFastify } from '../../src/app.js';
import { getDb } from '../../src/db/index.js';
import { agentJobs, outcomes } from '../../src/db/schema.js';
import { enqueueOutcomeRefresh, processDueAgentJobs, recoverStuckAgentJobs } from '../../src/agent/jobs.js';
import { resetDb } from '../helpers/db.js';
import { registerUser } from '../helpers/session.js';
import { injectJson } from '../helpers/http.js';

let app: FastifyInstance;
beforeAll(async () => { app = await buildFastify(); });
beforeEach(resetDb);
afterAll(async () => { await app.close(); });

it('survives SIGKILL after committed effects and resumes in another process without applying twice', async () => {
  const user = await registerUser(app);
  const res = await injectJson(app, { method: 'POST', url: '/api/v1/outcomes', token: user.token, payload: { name: 'restart proof' } });
  const outcomeId = res.json().id as string;
  await enqueueOutcomeRefresh(getDb(), user.id, outcomeId, new Date(), { delayMs: 0 });
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../helpers/crash-agent-worker.ts', import.meta.url))], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error(`worker did not commit: ${stderr}`)); }, 10_000);
      child.stdout.on('data', (data: Buffer) => { if (data.toString().includes('COMMITTED')) { clearTimeout(timeout); resolve(); } });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`early exit ${String(code)}: ${stderr}`)); });
    });
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const [running] = await getDb().select().from(agentJobs).where(eq(agentJobs.userId, user.id));
    expect(running).toMatchObject({ status: 'running', appliedGeneration: 1 });
    if (!running) throw new Error('job lost');
    await getDb().update(agentJobs).set({ leaseExpiresAt: new Date(0) }).where(eq(agentJobs.id, running.id));
    expect(await recoverStuckAgentJobs()).toBe(1);
    expect(await processDueAgentJobs()).toBe(1);
    expect((await getDb().select().from(agentJobs).where(eq(agentJobs.id, running.id)))[0]?.status).toBe('done');
    expect((await getDb().select().from(outcomes).where(eq(outcomes.id, outcomeId)))[0]?.agentHeadline).toBe('committed before crash');
  } finally { child.kill('SIGKILL'); }
});
