import { DateTime } from 'luxon';
import type { ChatInvalidateTag } from '@vital/dto';
import { getUserEntity } from '../../auth/auth.service.js';
import { getDb } from '../../db/index.js';
import { AppError } from '../../errors.js';
import { getTask, patchTask } from '../../tasks/tasks.service.js';
import { enqueueAgentJob } from '../jobs.js';

export type DeferFollowupIntent = 'cancel' | 'defer' | 'decompose';

/** Whole-utterance match. Trailing punctuation is ignored. */
export function deferFollowupIntent(text: string): DeferFollowupIntent | null {
  const trimmed = text.trim().replace(/[。！!？?]+$/u, '');
  if (trimmed === '不做了') return 'cancel';
  if (trimmed === '下周再说') return 'defer';
  if (trimmed === '帮我拆') return 'decompose';
  return null;
}

/** Next local week, or seven days after the current due when that is already later. */
export function deferToNextWeekYmd(now: Date, timezone: string, prevDueAt: Date | null): string {
  const zone = DateTime.fromJSDate(now, { zone: timezone }).isValid ? timezone : 'UTC';
  const today = DateTime.fromJSDate(now, { zone }).startOf('day');
  let target = today.plus({ days: 7 });
  if (prevDueAt) {
    const prev = DateTime.fromJSDate(prevDueAt, { zone }).startOf('day');
    if (prev.isValid && target <= prev) target = prev.plus({ days: 7 });
  }
  return target.toISODate() ?? today.toISODate() ?? '1970-01-08';
}

export async function applyDeferFollowup(input: {
  userId: string;
  taskId: string;
  intent: DeferFollowupIntent;
  now: Date;
}): Promise<{ text: string; invalidate: ChatInvalidateTag[] }> {
  let task;
  try {
    task = await getTask(input.userId, input.taskId);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return { text: '找不到这件任务。', invalidate: [] };
    throw err;
  }
  if (task.status === 'done') return { text: `「${task.title}」已经做完了。`, invalidate: [] };
  if (task.status === 'canceled' && input.intent !== 'cancel') {
    return { text: `「${task.title}」已经取消了。`, invalidate: [] };
  }
  if (input.intent === 'cancel') {
    if (task.status !== 'canceled') await patchTask(input.userId, task.id, { status: 'canceled' });
    return { text: `已取消「${task.title}」。`, invalidate: ['tasks', 'today'] };
  }
  if (input.intent === 'defer') {
    const user = await getUserEntity(input.userId);
    const ymd = deferToNextWeekYmd(input.now, user.timezone, task.dueAt ? new Date(task.dueAt) : null);
    await patchTask(input.userId, task.id, { dueYmd: ymd, timezone: user.timezone });
    return { text: `「${task.title}」改到 ${ymd}。`, invalidate: ['tasks', 'today'] };
  }
  const jobId = await enqueueAgentJob(getDb(), {
    userId: input.userId,
    jobType: 'task.decompose',
    payload: { taskId: task.id, manual: true, trigger: 'manual' },
    dedupKey: `task.decompose:${task.id}`,
    scheduledAt: input.now,
  });
  if (!jobId) return { text: `「${task.title}」这次没排上拆解。`, invalidate: [] };
  return { text: `正在拆「${task.title}」。`, invalidate: [] };
}
