import { processDueAgentJobs, recoverStuckAgentJobs } from './agent/jobs.js';
import { runAgentScheduler } from './agent/scheduler.js';
import { config } from './config.js';
import { pool } from './db/index.js';
import { healTaskNotifications, processDueNotifications } from './notifications/dispatch.js';
import { logger } from './utils/logger.js';

let stopping = false;

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
  void tick();
}, config.WORKER_POLL_MS);

const healTimer = setInterval(() => {
  void heal();
}, config.WORKER_HEAL_INTERVAL_MS);

const schedulerTimer = setInterval(() => {
  void schedule();
}, config.AGENT_SCHEDULER_INTERVAL_MS);

logger.info('worker started', {
  pollMs: config.WORKER_POLL_MS,
  healMs: config.WORKER_HEAL_INTERVAL_MS,
  agentSchedulerMs: config.AGENT_SCHEDULER_INTERVAL_MS,
  agentEnabled: config.AGENT_ENABLED,
});
void tick();
void heal();
void schedule();

function shutdown(sig: string): void {
  if (stopping) return;
  stopping = true;
  logger.info(`worker received ${sig}, shutting down`);
  clearInterval(poll);
  clearInterval(healTimer);
  clearInterval(schedulerTimer);
  void pool.end().then(
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
