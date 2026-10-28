import type { Task } from '@vital/dto';
import { client } from '@/api/client';
import { createPayload } from './model';
import { applyDraftToCreate, type ScheduleDraft } from './schedule-draft';
import type { ComposeExtras } from './QuickAdd';

/** Window event that opens the global quick-create overlay (⌘N on desktop, C in the browser). */
export const OPEN_QUICK_CREATE_EVENT = 'vital:quick-create';

/**
 * Global quick create (设计稿 design/today.html 画板 3): lands in the inbox by
 * default, AI parse keeps the today-page behavior — smart:today makes a
 * date-less phrase fall back to today, listId stays the picked list.
 */
export async function quickCreateTask(input: {
  name: string;
  draft: ScheduleDraft;
  extras: ComposeExtras;
  inboxId: string;
  timeZone: string;
  intent: boolean;
}): Promise<Task> {
  const { name, draft, extras, inboxId, timeZone, intent } = input;
  if (intent) {
    return client.createTaskFromText({
      text: name,
      listId: extras.listId || inboxId,
      timezone: timeZone,
      smartListId: 'smart:today',
      ...(extras.status !== undefined ? { status: extras.status } : {}),
      ...(extras.priority !== undefined ? { priority: extras.priority } : {}),
    });
  }
  const base = createPayload(name, inboxId, inboxId, timeZone, new Date());
  const next = applyDraftToCreate(base, draft, timeZone);
  if (extras.listId) next.listId = extras.listId;
  if (extras.priority !== undefined && extras.priority !== 3) next.priority = extras.priority;
  if (extras.status) next.status = extras.status;
  return client.createTask(next);
}
