import type { ChatContext, Task } from '@vital/dto';
import { todoKeys } from '@/features/todos/query-keys';
import { appQueryClient } from '@/services/query.service';
import { listIdFrom, sectionOf } from '@/shell/section';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function chatPageContext(pathname: string, search: string, taskId: string | null): ChatContext {
  const section = sectionOf(pathname, search);
  let listId: string | null = null;
  if (section === 'today') listId = 'smart:today';
  else if (section === 'capture') listId = 'smart:inbox';
  else if (section === 'todos') listId = listIdFrom(pathname, search);

  const cached = listId ? (appQueryClient.getQueryData<Task[]>(todoKeys.tasks(listId)) ?? []) : [];
  const visible = cached.filter((task) => task.habitId === null);
  const truncated = visible.length > 20;
  const inboxMatch = /^\/inbox\/([^/]+)$/.exec(pathname);
  const threadMatch = /^\/today\/threads\/([^/]+)$/.exec(pathname);
  const inboxId = inboxMatch?.[1] && UUID.test(inboxMatch[1]) ? inboxMatch[1] : null;
  const outcomeId = threadMatch?.[1] && UUID.test(threadMatch[1]) ? threadMatch[1] : null;

  return {
    section,
    listId,
    taskId,
    habitId: null,
    inboxId,
    outcomeId,
    visibleTaskIds: truncated ? [] : visible.slice(0, 20).map((task) => task.id),
    visibleTruncated: truncated,
  };
}
