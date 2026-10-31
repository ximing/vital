import { db, pool } from '../../src/db/index.js';
import {
  agentActions,
  agentEditEvents,
  agentEditFeedback,
  agentExecutions,
  agentJobs,
  agentMemory,
  agentMemoryFeedback,
  agentMemoryHistory,
  agentMemoryMaintenance,
  agentChatBudgets,
  agentChatConversations,
  agentChatMessages,
  agentChatPreviews,
  agentModelBudgets,
  agentScheduling,
  agentUsage,
  apiTokenAccessLogs,
  apiTokens,
  attachments,
  entityLinks,
  extensionAuthCodes,
  qrLoginTickets,
  continuityContractRevisions,
  continuityContracts,
  continuityDependencies,
  continuityEvidence,
  continuityEvidenceLinks,
  continuityEvents,
  continuityExperiments,
  continuityExposures,
  continuityInterventions,
  continuityMemorySuppressions,
  continuityOpportunities,
  continuityProtectedBlocks,
  continuityUserSettings,
  days,
  energyLogs,
  explorationProposals,
  explorationVerifications,
  explorationWindows,
  habits,
  holidayCalendar,
  holidayCalendarSources,
  inboxAssets,
  inboxExtractJobs,
  inboxIdempotencyResponses,
  inboxItemBodies,
  inboxItemTags,
  inboxItems,
  lists,
  notificationChannels,
  notificationDeliveries,
  notificationOutbox,
  pushDeliveries,
  pushDevices,
  outcomes,
  reports,
  refreshTokens,
  tags,
  taskCompletions,
  tasks,
  taskTags,
  todayLayouts,
  userLlmProviders,
  userLlmRoutes,
  userInwitConfig,
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
    await db.delete(pushDeliveries);
    await db.delete(pushDevices);
    await db.delete(notificationDeliveries);
    await db.delete(notificationOutbox);
    await db.delete(notificationChannels);
    await db.delete(agentUsage);
    await db.delete(agentActions);
    await db.delete(agentExecutions);
    await db.delete(agentMemory);
    await db.delete(agentMemoryFeedback);
    await db.delete(agentMemoryHistory);
    await db.delete(agentMemoryMaintenance);
    await db.delete(agentEditFeedback);
    await db.delete(agentEditEvents);
    await db.delete(agentJobs);
    await db.delete(agentScheduling);
    await db.delete(agentChatMessages);
    await db.delete(agentChatPreviews);
    await db.delete(agentChatConversations);
    await db.delete(agentChatBudgets);
    await db.delete(agentModelBudgets);
    await db.delete(inboxExtractJobs);
    await db.delete(inboxAssets);
    await db.delete(inboxItemTags);
    await db.delete(inboxItemBodies);
    await db.delete(inboxIdempotencyResponses);
    await db.delete(entityLinks);
    await db.delete(inboxItems);
    await db.delete(taskTags);
    await db.delete(taskCompletions);
    await db.delete(tasks);
    await db.delete(energyLogs);
    await db.delete(days);
    await db.delete(habits);
    await db.delete(continuityExposures);
    await db.delete(continuityInterventions);
    await db.delete(continuityExperiments);
    await db.delete(continuityEvidenceLinks);
    await db.delete(continuityEvidence);
    await db.delete(continuityOpportunities);
    await db.delete(continuityEvents);
    await db.delete(continuityMemorySuppressions);
    await db.delete(continuityDependencies);
    await db.delete(continuityProtectedBlocks);
    await db.delete(continuityContractRevisions);
    await db.delete(continuityContracts);
    await db.delete(continuityUserSettings);
    await db.delete(explorationVerifications);
    await db.delete(explorationProposals);
    await db.delete(explorationWindows);
    await db.delete(outcomes);
    await db.delete(holidayCalendarSources);
    await db.delete(holidayCalendar);
    await db.delete(tags);
    await db.delete(lists);
    await db.delete(attachments);
    await db.delete(reports);
    await db.delete(refreshTokens);
    await db.delete(apiTokenAccessLogs);
    await db.delete(apiTokens);
    await db.delete(extensionAuthCodes);
    await db.delete(qrLoginTickets);
    await db.delete(userLlmRoutes);
    await db.delete(userLlmProviders);
    await db.delete(userInwitConfig);
    await db.delete(todayLayouts);
    await db.delete(users);
  });
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
