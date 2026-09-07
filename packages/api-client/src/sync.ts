import type { InboxItem, ReportListItem, SyncChanges, SyncHead, Task } from '@vital/dto';

export function syncEventsUrl(
  baseUrl: string,
  loc: { protocol: string; host: string } = globalThis.location,
): string {
  if (baseUrl === '') {
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${loc.host}/api/v1/sync/events`;
  }
  const url = new URL('/api/v1/sync/events', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function syncHeadMoved(prev: SyncHead | null, next: SyncHead): boolean {
  if (prev === null) return true;
  return (
    prev.tasksMaxUpdatedAt !== next.tasksMaxUpdatedAt ||
    prev.inboxMaxUpdatedAt !== next.inboxMaxUpdatedAt ||
    prev.reportsMaxUpdatedAt !== next.reportsMaxUpdatedAt ||
    prev.revision !== next.revision
  );
}

export function latestUpdatedAt(
  changes: Pick<SyncChanges, 'tasks' | 'inbox' | 'reports'>,
): string | null {
  let max = 0;
  let iso: string | null = null;
  for (const row of [...changes.tasks, ...changes.inbox, ...changes.reports]) {
    const t = Date.parse(row.updatedAt);
    if (Number.isFinite(t) && t > max) {
      max = t;
      iso = row.updatedAt;
    }
  }
  return iso;
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const idx = items.findIndex((row) => row.id === next.id);
  if (idx < 0) return [next, ...items];
  const copy = items.slice();
  copy[idx] = next;
  return copy;
}

export function mergeTasksIntoList(items: Task[], changes: Task[], listId?: string): Task[] {
  let next = items;
  const smart = listId !== undefined && listId.startsWith('smart:');
  for (const task of changes) {
    const idx = next.findIndex((row) => row.id === task.id);
    if (task.deletedAt) {
      if (idx >= 0) next = next.filter((row) => row.id !== task.id);
      continue;
    }
    if (listId && !smart && task.listId !== listId) {
      if (idx >= 0) next = next.filter((row) => row.id !== task.id);
      continue;
    }
    if (idx < 0) {
      if (smart) continue;
      next = [task, ...next];
      continue;
    }
    const copy = next.slice();
    copy[idx] = task;
    next = copy;
  }
  return next;
}

export function mergeInboxItems(items: InboxItem[], changes: InboxItem[]): InboxItem[] {
  let next = items;
  for (const item of changes) {
    if (item.deletedAt || item.status === 'archived') {
      next = next.filter((row) => row.id !== item.id);
      continue;
    }
    next = upsertById(next, item);
  }
  return next;
}

export function mergeReportListItems(
  items: ReportListItem[],
  changes: ReportListItem[],
): ReportListItem[] {
  let next = items;
  for (const item of changes) next = upsertById(next, item);
  return next;
}
