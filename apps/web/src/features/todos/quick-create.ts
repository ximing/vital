import type { Task } from '@vital/dto';
import { client } from '@/api/client';
import { createPayload } from './model';
import {
  applyDraftToCreate,
  applySchedulePin,
  schedulePinPatch,
  type ScheduleDraft,
} from './schedule-draft';
import type { ComposeExtras } from './QuickAdd';

/** Window event that opens the global quick-create overlay (⌘N on desktop, C in the browser). */
export const OPEN_QUICK_CREATE_EVENT = 'vital:quick-create';

/** Ask the overlay to close. The schedule page uses this when the week or month changes. */
export const CLOSE_QUICK_CREATE_EVENT = 'vital:quick-create-close';

/** The overlay closed, whether by Escape, the backdrop, or a successful create. */
export const QUICK_CREATE_CLOSED_EVENT = 'vital:quick-create-closed';

export type QuickCreateOpenDetail = {
  pinSchedule: true;
  draft: ScheduleDraft;
  rangeLabel: string;
};

export function isQuickCreatePin(value: unknown): value is QuickCreateOpenDetail {
  if (value === null || typeof value !== 'object') return false;
  const detail = value as Partial<QuickCreateOpenDetail>;
  return detail.pinSchedule === true && detail.draft !== undefined && typeof detail.rangeLabel === 'string';
}

export function openQuickCreate(detail?: QuickCreateOpenDetail): void {
  window.dispatchEvent(new CustomEvent(OPEN_QUICK_CREATE_EVENT, { detail }));
}

export function closeQuickCreate(): void {
  window.dispatchEvent(new CustomEvent(CLOSE_QUICK_CREATE_EVENT));
}

/**
 * Global quick create (设计稿 design/today.html 画板 3): lands in the inbox by
 * default, AI parse keeps the today-page behavior — smart:today makes a
 * date-less phrase fall back to today, listId stays the picked list.
 * A schedule gesture sets pinSchedule so the dragged interval wins over dates
 * spoken in the sentence. The pin is only start, end, and all-day.
 */
export async function quickCreateTask(input: {
  name: string;
  draft: ScheduleDraft;
  extras: ComposeExtras;
  inboxId: string;
  timeZone: string;
  intent: boolean;
  pinSchedule?: boolean;
}): Promise<Task> {
  const { name, draft, extras, inboxId, timeZone, intent, pinSchedule = false } = input;
  if (intent) {
    const task = await client.createTaskFromText({
      text: name,
      listId: extras.listId || inboxId,
      timezone: timeZone,
      smartListId: 'smart:today',
      ...(extras.status !== undefined ? { status: extras.status } : {}),
      ...(extras.priority !== undefined ? { priority: extras.priority } : {}),
    });
    if (!pinSchedule) return task;
    const pin = schedulePinPatch(draft, timeZone);
    if (pin === null) return task;
    return client.patchTask(task.id, pin);
  }
  const base = createPayload(name, inboxId, inboxId, timeZone, new Date());
  const next = pinSchedule
    ? applySchedulePin(base, draft, timeZone)
    : applyDraftToCreate(base, draft, timeZone);
  if (extras.listId) next.listId = extras.listId;
  if (extras.priority !== undefined && extras.priority !== 3) next.priority = extras.priority;
  if (extras.status) next.status = extras.status;
  return client.createTask(next);
}
