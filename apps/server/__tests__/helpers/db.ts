import { db, pool } from '../../src/db/index.js';
import {
  agentActions,
  agentJobs,
  agentMemory,
  agentUsage,
  apiTokenAccessLogs,
  apiTokens,
  attachments,
  entityLinks,
  extensionAuthCodes,
  habits,
  holidayCalendar,
  inboxAssets,
  inboxItemTags,
  inboxItems,
  lists,
  notificationChannels,
  notificationDeliveries,
  notificationOutbox,
  outcomes,
  reports,
  refreshTokens,
  tags,
  taskCompletions,
  tasks,
  taskTags,
  users,
} from '../../src/db/schema.js';

const RETRYABLE = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT']);

function isRetryable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code =
    typeof e?.code === 'string'
      ? e.code
      : typeof e?.cause?.code === 'string'
        ? e.cause.code
        : undefined;
  return code !== undefined && RETRYABLE.has(code);
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err) || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 200 * (i + 1)));
    }
  }
  throw new Error('unreachable');
}

export async function resetDb(): Promise<void> {
  await withRetry(async () => {
    await db.delete(notificationDeliveries);
    await db.delete(notificationOutbox);
    await db.delete(notificationChannels);
    await db.delete(agentUsage);
    await db.delete(agentActions);
    await db.delete(agentMemory);
    await db.delete(agentJobs);
    await db.delete(inboxAssets);
    await db.delete(inboxItemTags);
    await db.delete(entityLinks);
    await db.delete(inboxItems);
    await db.delete(taskTags);
    await db.delete(taskCompletions);
    await db.delete(tasks);
    await db.delete(habits);
    await db.delete(outcomes);
    await db.delete(holidayCalendar);
    await db.delete(tags);
    await db.delete(lists);
    await db.delete(attachments);
    await db.delete(reports);
    await db.delete(refreshTokens);
    await db.delete(apiTokenAccessLogs);
    await db.delete(apiTokens);
    await db.delete(extensionAuthCodes);
    await db.delete(users);
  });
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
