import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users, type AgentJobRow, type User } from '../db/schema.js';
import { processWeeklyObserve } from '../notifications/weekly-observe.js';
import { syncSearchIndexes } from '../retrieval/search.js';
import { syncUserIndexes } from '../retrieval/sync.js';
import { processErrand } from './errand.js';
import { executionResult, skipExecution, withExecution } from './executions.service.js';
import { UnknownAgentJobTypeError } from './jobs.js';
import { RetryableAgentJobError } from './job-runtime.js';
import { processMemoryDistill } from './memory-distill.js';
import { processNotifyScan } from './notify-scan.js';
import { processOutcomeCluster } from './outcome-cluster.js';
import { processOutcomeRefresh } from './outcome-refresh.js';
import { processReflectDaily } from './reflect-daily.js';
import { processReportGenerate } from './report-generate.js';
import { processTaskDecompose } from './task-decompose.js';
import { processTaskDraft } from './task-draft.js';
import { processTodayLayout } from './today-layout.js';

export type AgentJobResult = 'done' | 'skipped:no-llm';

export async function processAgentJob(job: AgentJobRow, now: Date): Promise<AgentJobResult> {
  return withExecution({
    userId: job.userId, capability: job.jobType, jobId: job.id, attempt: job.attemptCount + 1,
    ...('taskId' in job.payload ? { targetType: 'task', targetId: job.payload.taskId } : {}),
    ...('outcomeId' in job.payload ? { targetType: 'outcome', targetId: job.payload.outcomeId } : {}),
    ...('reportId' in job.payload ? { targetType: 'report', targetId: job.payload.reportId } : {}),
  }, async () => {
    const result = await processAgentJobInner(job, now);
    if (result === 'skipped:no-llm') skipExecution('NO_MODEL');
    return result;
  });
}

/**
 * Healing job: rebuilds the user's derived indexes from PG and prunes stale
 * ids. External-service failures are retryable — a half-finished sync must
 * back off and retry, never report done.
 */
async function processIndexSync(
  _job: AgentJobRow,
  user: User,
  _now: Date,
): Promise<AgentJobResult> {
  let stats: Awaited<ReturnType<typeof syncUserIndexes>>;
  let searchStats: Awaited<ReturnType<typeof syncSearchIndexes>>;
  try {
    stats = await syncUserIndexes(user.id);
    searchStats = await syncSearchIndexes(user.id);
  } catch (err) {
    throw new RetryableAgentJobError('index.sync failed', { cause: err });
  }
  executionResult({
    resultSummary: `同步记忆 ${String(stats.memories)} 条、任务 ${String(stats.tasks)} 条、线程 ${String(searchStats.outcomes)} 条、收集箱 ${String(searchStats.inbox)} 条，清理 ${String(stats.removed + searchStats.removed)} 条`,
    inputSummary: '仅当前用户的记忆、任务、线程与收集箱索引全量对齐',
  });
  return 'done';
}

async function processAgentJobInner(job: AgentJobRow, now: Date): Promise<AgentJobResult> {
  const [user] = await getDb().select().from(users).where(eq(users.id, job.userId)).limit(1);
  if (!user) return 'done';
  switch (job.jobType) {
    case 'outcome.refresh':
      return processOutcomeRefresh(job, user, now);
    case 'outcome.cluster':
      return processOutcomeCluster(job, user, now);
    case 'task.decompose':
      return processTaskDecompose(job, user, now);
    case 'task.draft':
      return processTaskDraft(job, user, now);
    case 'report.generate':
      return processReportGenerate(job, user, now);
    case 'reflect.daily':
      return processReflectDaily(job, user, now);
    case 'reflect.weekly':
      return processWeeklyObserve(job, user, now);
    case 'memory.distill':
      return processMemoryDistill(job, user, now);
    case 'index.sync':
      return processIndexSync(job, user, now);
    case 'today.layout':
      return processTodayLayout(user, now);
    case 'errand.run':
      return processErrand(job, user, now);
    case 'notify.scan':
      return processNotifyScan(job, user, now);
    default:
      // Old worker meeting a newer job type (e.g. task.draft during the v1.3
      // rollout): never swallow it as done — fail loudly so it is visible.
      throw new UnknownAgentJobTypeError(job.jobType);
  }
}
