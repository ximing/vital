import type { List, ListId } from '@vital/dto';
import { copy } from '../../lib/copy';

export type TaskListView = 'list' | 'board' | 'week';

export const SMART_ORDER = [
  'smart:today',
  'smart:inbox',
  'smart:upcoming',
  'smart:someday',
  'smart:done',
] as const;

export function listLabel(list: List): string {
  return titleCopy(list.id);
}

export function titleCopy(listId: string): string {
  if (listId === 'smart:today') return copy.lists.today;
  if (listId === 'smart:inbox') return copy.lists.inbox;
  if (listId === 'smart:upcoming') return copy.lists.upcoming;
  if (listId === 'smart:someday') return copy.lists.someday;
  if (listId === 'smart:done') return copy.lists.done;
  return copy.nav.todos;
}

export function emptyCopy(listId: string): string {
  if (listId === 'smart:today') return copy.empty.today;
  if (listId === 'smart:done') return copy.empty.done;
  if (listId === 'smart:inbox') return copy.empty.inboxList;
  if (listId.startsWith('smart:')) return copy.empty.upcoming;
  return copy.empty.userList;
}

export function isSmartList(listId: ListId | string): boolean {
  return String(listId).startsWith('smart:');
}
