import type { AgentJobRow } from '../db/schema.js';
import { withAgentJobEffects } from './job-runtime.js';
import { finishAgentSchedule } from './scheduling.js';

export function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export async function finishUnchangedSchedule(job: AgentJobRow, userId: string, capability: 'outcome.cluster' | 'memory.distill', now: Date): Promise<void> {
  await withAgentJobEffects(job, async tx => {
    if ('scheduleGeneration' in job.payload && typeof job.payload.scheduleGeneration === 'number') await finishAgentSchedule(tx, userId, capability, job.payload.scheduleGeneration, now);
  });
}
