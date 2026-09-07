import type { InboxItem, ReportListItem, SyncChanges, Task } from '@vital/dto';
import { mergeInboxItems, mergeReportListItems, mergeTasksIntoList } from '@vital/api-client';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { inboxKeys } from '@/features/inbox/queries';
import { reportKeys } from '@/features/reports/queries';
import { todoKeys } from '@/features/todos/queries';

function listIdOf(key: QueryKey): string | undefined {
  return typeof key[2] === 'string' ? key[2] : undefined;
}

export function applySyncChanges(qc: QueryClient, changes: SyncChanges): void {
  if (changes.tasks.length > 0) {
    for (const [key, data] of qc.getQueriesData<Task[]>({ queryKey: todoKeys.all })) {
      if (!Array.isArray(data) || key[1] !== 'tasks') continue;
      const listId = listIdOf(key);
      if (!listId) continue;
      if (listId.startsWith('smart:')) {
        void qc.invalidateQueries({ queryKey: key });
        continue;
      }
      qc.setQueryData(key, mergeTasksIntoList(data, changes.tasks, listId));
    }
    void qc.invalidateQueries({ queryKey: ['todos', 'calendar'] });
  }

  if (changes.inbox.length > 0) {
    const list = qc.getQueryData<InboxItem[]>(inboxKeys.list);
    if (list) qc.setQueryData(inboxKeys.list, mergeInboxItems(list, changes.inbox));
    for (const item of changes.inbox) {
      if (item.deletedAt) qc.removeQueries({ queryKey: inboxKeys.item(item.id) });
      else qc.setQueryData(inboxKeys.item(item.id), item);
    }
  }

  if (changes.reports.length > 0) {
    for (const item of changes.reports) {
      const key = reportKeys.list(item.type);
      const list = qc.getQueryData<ReportListItem[]>(key);
      if (list) qc.setQueryData(key, mergeReportListItems(list, [item]));
    }
    void qc.invalidateQueries({ queryKey: ['reports', 'overview'] });
  }
}
