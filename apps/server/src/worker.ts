import { drainAgentJobs, processDueAgentJobs, recoverStuckAgentJobs } from './agent/jobs.js';
import { runAgentScheduler } from './agent/scheduler.js';
import { config } from './config.js';
import { pool } from './db/index.js';
import { healTaskNotifications, processDueNotifications } from './notifications/dispatch.js';
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
    const n = await recoverStuckAgentJobs();
    if (n > 0) logger.info('worker.agent.heal', { recovered: n });
  } catch (err) {
    logger.error('worker.agent.heal.failed', err);
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
}, config.WORKER_POLL_MS);

const healTimer = setInterval(() => {
  track(heal);
}, config.WORKER_HEAL_INTERVAL_MS);

const schedulerTimer = setInterval(() => {
  track(schedule);
}, config.AGENT_SCHEDULER_INTERVAL_MS);

logger.info('worker started', {
  pollMs: config.WORKER_POLL_MS,
  healMs: config.WORKER_HEAL_INTERVAL_MS,
  agentSchedulerMs: config.AGENT_SCHEDULER_INTERVAL_MS,
  agentEnabled: config.AGENT_ENABLED,
});
track(tick);
track(heal);
track(schedule);

function shutdown(sig: string): void {
  if (stopping) return;
  stopping = true;
  logger.info(`worker received ${sig}, shutting down`);
  clearInterval(poll);
  clearInterval(healTimer);
  clearInterval(schedulerTimer);
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
