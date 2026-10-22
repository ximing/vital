import type { AgentJobRow, User } from '../../db/schema.js';
import { executionResult, skipExecution } from '../executions.service.js';
import { taskById } from './store.js';
import { isErrandPayload } from './model.js';
import { processOrganize } from './organize.js';
import { processRead } from './read.js';

export async function processErrand(job: AgentJobRow, user: User, now: Date): Promise<'done'> {
  if (!isErrandPayload(job.payload)) {
    skipExecution('INVALID_PAYLOAD');
    return 'done';
  }
  const task = await taskById(user.id, job.payload.taskId);
  if (!task || task.deletedAt) {
    skipExecution('TASK_NOT_FOUND');
    return 'done';
  }
  if (task.status === 'canceled') {
    skipExecution('TASK_CLOSED');
    return 'done';
  }
  executionResult({
    targetType: 'task',
    targetId: task.id,
    inputSummary: job.payload.kind === 'inbox.read_summarize' ? '读一篇收集箱' : '整理收集箱',
  });
  if (job.payload.kind === 'inbox.read_summarize') {
    const inboxItemId = job.payload.inboxItemId;
    if (!inboxItemId) {
      skipExecution('INVALID_PAYLOAD');
      return 'done';
    }
    return processRead(job, user, task, inboxItemId, now);
  }
  const ids = job.payload.inboxItemIds ?? [];
  if (ids.length === 0) {
    skipExecution('INVALID_PAYLOAD');
    return 'done';
  }
  return processOrganize(job, user, task, ids, now);
}
