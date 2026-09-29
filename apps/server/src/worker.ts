import { drainAgentJobs, processDueAgentJobs, recoverStuckAgentJobs } from './agent/jobs.js';
import { runAgentScheduler } from './agent/scheduler.js';
import { config } from './config.js';
import { pool } from './db/index.js';
import { processQueuedExtractJobs } from './inbox/extract-jobs.js';
import { backfillLinkOnlyInbox } from './inbox/link-extract.js';
import { healTaskNotifications, processDueNotifications } from './notifications/dispatch.js';
import { enqueueEveningDigests } from './notifications/evening-digest.js';
import { healDayNotifications } from './days/outbox.js';
import { startSweeper } from './uploads/sweeper.js';
import { logger } from './utils/logger.js';

let stopping = false;
const inFlight = new Set<Promise<void>>();
const running = new Set<() => Promise<void>>();
function track(fn: () => Promise<void>): void {
  if (stopping || running.has(fn)) return;
  running.add(fn);
  const task = fn();
  inFlight.add(task);
  void task.finally(() => { inFlight.delete(task); running.delete(fn); });
}

async function extractJobs(): Promise<void> {
  if (stopping) return;
  try {
    const n = await processQueuedExtractJobs();
    if (n.claimed > 0) logger.info('worker.extract-job', n);
  } catch (err) {
    logger.error('worker.extract-job.failed', err);
  }
}

async function tick(): Promise<void> {
  if (stopping) return;
  try {
    const n = await processDueNotifications();
    if (n > 0) logger.info('worker.tick', { claimed: n });
  } catch (err) {
    logger.error('worker.tick.failed', err);
  }
  try {
    const n = await processDueAgentJobs();
    if (n > 0) logger.info('worker.agent.tick', { claimed: n });
  } catch (err) {
    logger.error('worker.agent.tick.failed', err);
  }
}

async function heal(): Promise<void> {
  if (stopping) return;
  try {
    const n = await healTaskNotifications();
    if (n > 0) logger.info('worker.heal', { scanned: n });
  } catch (err) {
    logger.error('worker.heal.failed', err);
  }
  try {
    const n = await healDayNotifications();
    if (n > 0) logger.info('worker.heal.days', { scanned: n });
  } catch (err) {
    logger.error('worker.heal.days.failed', err);
  }
  try {
    const n = await enqueueEveningDigests();
    if (n > 0) logger.info('worker.digest', { scheduled: n });
  } catch (err) {
    logger.error('worker.digest.failed', err);
  }
  try {
    const n = await recoverStuckAgentJobs();
    if (n > 0) logger.info('worker.agent.heal', { recovered: n });
  } catch (err) {
    logger.error('worker.agent.heal.failed', err);
  }
  try {
    const n = await backfillLinkOnlyInbox();
    if (n.claimed > 0) logger.info('worker.link-extract', n);
  } catch (err) {
    logger.error('worker.link-extract.failed', err);
  }
}

async function schedule(): Promise<void> {
  if (stopping) return;
  try {
    const n = await runAgentScheduler();
    if (n > 0) logger.info('worker.agent.schedule', { users: n });
  } catch (err) {
    logger.error('worker.agent.schedule.failed', err);
  }
}

const poll = setInterval(() => {
  track(tick);
  track(extractJobs);
}, config.WORKER_POLL_MS);

const healTimer = setInterval(() => {
  track(heal);
}, config.WORKER_HEAL_INTERVAL_MS);

const schedulerTimer = setInterval(() => {
  track(schedule);
}, config.AGENT_SCHEDULER_INTERVAL_MS);

const sweeperTimer = startSweeper();

logger.info('worker started', {
  pollMs: config.WORKER_POLL_MS,
  healMs: config.WORKER_HEAL_INTERVAL_MS,
  agentSchedulerMs: config.AGENT_SCHEDULER_INTERVAL_MS,
  agentEnabled: config.AGENT_ENABLED,
});
track(tick);
track(extractJobs);
track(heal);
track(schedule);

function shutdown(sig: string): void {
  if (stopping) return;
  stopping = true;
  logger.info(`worker received ${sig}, shutting down`);
  clearInterval(poll);
  clearInterval(healTimer);
  clearInterval(schedulerTimer);
  clearInterval(sweeperTimer);
  void (async () => {
    await drainAgentJobs();
    await Promise.allSettled([...inFlight]);
    await pool.end();
  })().then(
    () => process.exit(0),
    (err: unknown) => {
      logger.error('worker shutdown failed', err);
      process.exit(1);
    },
  );
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    shutdown(sig);
  });
}
