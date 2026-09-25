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
  if (list.kind === 'user') return list.name;
  return titleCopy(list.id);
}

/** User lists in drawer order: pinned siblings first, children tucked under their parent. */
export function visibleUserLists(lists: List[]): { list: List; depth: number }[] {
  const users = lists.filter((row) => row.kind === 'user' && !row.isArchived);
  const ids = new Set(users.map((row) => row.id));
  const children = new Map<string | null, List[]>();
  for (const row of users) {
    const parent = row.parentId !== null && ids.has(row.parentId) ? row.parentId : null;
    const bucket = children.get(parent) ?? [];
    bucket.push(row);
    children.set(parent, bucket);
  }
  for (const bucket of children.values()) {
    bucket.sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        a.sortOrder - b.sortOrder ||
        a.id.localeCompare(b.id),
    );
  }
  const out: { list: List; depth: number }[] = [];
  function walk(parent: string | null, depth: number): void {
    for (const row of children.get(parent) ?? []) {
      out.push({ list: row, depth });
      if (depth === 0) walk(row.id, 1);
    }
  }
  walk(null, 0);
  return out;
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
