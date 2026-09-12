import type {
  CalendarInstance,
  CreateListInput,
  CreateTaskFromTextInput,
  CreateTaskInput,
  List,
  PatchListInput,
  PatchTaskInput,
  ReorderListsInput,
  Tag,
  Task,
  TaskPriority,
} from '@vital/dto';
import { useService } from '@rabjs/react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { markOnboarding } from '@/features/onboarding/mark';
import { TodosUiService } from './todos-ui.service';

export const todoKeys = {
  all: ['todos'] as const,
  lists: ['todos', 'lists'] as const,
  tags: ['todos', 'tags'] as const,
  counts: ['todos', 'counts'] as const,
  tasks: (listId: string) => ['todos', 'tasks', listId] as const,
  item: (id: string) => ['todos', 'task', id] as const,
  calendar: (from: string, to: string) => ['todos', 'calendar', from, to] as const,
};

async function fetchAllTasks(listId: string): Promise<Task[]> {
  const items: Task[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i += 1) {
    const page = await client.listTasks({ listId, cursor, limit: 100 });
    items.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return items;
}

export function useListsQuery() {
  return useQuery({
    queryKey: todoKeys.lists,
    queryFn: async (): Promise<List[]> => {
      const res = await client.listLists();
      return res.items;
    },
  });
}

export function useTagsQuery() {
  return useQuery({
    queryKey: todoKeys.tags,
    queryFn: async (): Promise<Tag[]> => {
      const res = await client.listTags();
      return res.items;
    },
  });
}

export function useCountsQuery() {
  return useQuery({
    queryKey: todoKeys.counts,
    queryFn: async (): Promise<Record<string, number>> => {
      const res = await client.taskCounts();
      return res.counts;
    },
    refetchInterval: 60_000,
  });
}

export function useTasksQuery(listId: string, enabled = true) {
  return useQuery({
    queryKey: todoKeys.tasks(listId),
    queryFn: () => fetchAllTasks(listId),
    enabled: enabled && listId !== '',
  });
}

export function findTaskInCache(qc: QueryClient, id: string): Task | undefined {
  for (const [, data] of qc.getQueriesData<Task[]>({ queryKey: ['todos', 'tasks'] })) {
    if (!Array.isArray(data)) continue;
    const found = data.find((task) => task.id === id);
    if (found) return found;
  }
  return qc.getQueryData<Task>(todoKeys.item(id));
}

export function useTaskQuery(id: string | null) {
  return useQuery({
    queryKey: todoKeys.item(id ?? ''),
    queryFn: () => {
      if (id === null || id === '') throw new Error('task id required');
      return client.getTask(id);
    },
    enabled: id !== null && id !== '',
  });
}

/**
 * Task shown in the detail pane. Subtasks often live on the parent list but
 * not on the current smart list (e.g. today), so the pane must not depend on
 * the visible row set alone.
 */
export function useDetailTask(selectedId: string | null, localTasks: Task[]): Task | undefined {
  const qc = useQueryClient();
  const fromLocal = selectedId
    ? localTasks.find((task) => task.id === selectedId)
    : undefined;
  const fromCache =
    selectedId !== null && fromLocal === undefined
      ? findTaskInCache(qc, selectedId)
      : undefined;
  const fetchId =
    selectedId !== null && fromLocal === undefined && fromCache === undefined
      ? selectedId
      : null;
  const fetched = useTaskQuery(fetchId);
  return fromLocal ?? fromCache ?? fetched.data;
}

export function useCalendarQuery(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: todoKeys.calendar(from, to),
    queryFn: async (): Promise<CalendarInstance[]> => {
      const res = await client.calendar({ from, to });
      return res.instances;
    },
    enabled,
  });
}

export function useTodoActions() {
  const qc = useQueryClient();
  const todos = useService(TodosUiService);
  const invalidate = () => qc.invalidateQueries({ queryKey: todoKeys.all });

  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => client.createTask(input),
    onSuccess: async (task) => {
      qc.setQueryData(todoKeys.item(task.id), task);
      await invalidate();
      await markOnboarding({ createdTask: true });
      todos.setSelected(task.id);
    },
  });

  const createFromText = useMutation({
    mutationFn: (input: CreateTaskFromTextInput) => client.createTaskFromText(input),
    onSuccess: async (task) => {
      qc.setQueryData(todoKeys.item(task.id), task);
      await invalidate();
      await markOnboarding({ createdTask: true });
      todos.setSelected(task.id);
      todos.openDetail(task.id);
    },
  });

  const patch = useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchTaskInput }) =>
      client.patchTask(id, input),
    onSuccess: (task) => {
      qc.setQueryData(todoKeys.item(task.id), task);
      return invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => client.deleteTask(id),
    onSuccess: () => {
      todos.closeDetail();
      return invalidate();
    },
  });

  const reorder = useMutation({
    mutationFn: (input: { listId: string; parentId?: string | null; orderedIds: string[] }) =>
      client.reorderTasks(input),
    onSuccess: () => invalidate(),
  });

  const createList = useMutation({
    mutationFn: (input: CreateListInput) => client.createList(input),
    onSuccess: () => invalidate(),
  });

  const patchList = useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchListInput }) =>
      client.patchList(id, input),
    onSuccess: () => invalidate(),
  });

  const deleteList = useMutation({
    mutationFn: (id: string) => client.deleteList(id),
    onSuccess: () => invalidate(),
  });

  const reorderLists = useMutation({
    mutationFn: (input: ReorderListsInput) => client.reorderLists(input),
    onSuccess: () => invalidate(),
  });

  const createTag = useMutation({
    mutationFn: (name: string) => client.createTag({ name }),
    onSuccess: () => invalidate(),
  });

  async function complete(task: Task): Promise<void> {
    if (task.status === 'canceled') return;
    if (task.status === 'done' && task.recurrence === null) return;
    const ui = todos;
    if (ui.completeUndo && !ui.completeUndo.wantUndo && ui.completeUndo.taskId === task.id) {
      await undoComplete();
      return;
    }
    ui.startComplete(task);
    try {
      const res = await client.completeTask(task.id);
      const live = todos.completeUndo;
      todos.setCompletionId(task.id, res.undo.completionId);
      if (live?.taskId === task.id && live.wantUndo) {
        await client.uncompleteTask(task.id, { completionId: res.undo.completionId });
        todos.finishUndo();
      }
      await invalidate();
      await markOnboarding({ completedTask: true });
    } catch (err) {
      todos.failComplete();
      throw err;
    }
  }

  async function undoComplete(): Promise<void> {
    const live = todos.completeUndo;
    if (!live) return;
    if (live.completionId === null) {
      todos.markWantUndo();
      return;
    }
    await client.uncompleteTask(live.taskId, { completionId: live.completionId });
    todos.finishUndo();
    await invalidate();
  }

  async function setPriority(task: Task, priority: TaskPriority): Promise<void> {
    if (task.priority === priority) return;
    await patch.mutateAsync({ id: task.id, input: { priority } });
  }

  async function setStatus(task: Task, status: 'todo' | 'doing'): Promise<void> {
    if (task.status === 'done') {
      const completionId = todos.lastCompletionId[task.id];
      if (completionId === undefined) return;
      await client.uncompleteTask(task.id, { completionId });
      if (status === 'doing') await client.patchTask(task.id, { status: 'doing' });
      await invalidate();
      return;
    }
    if (task.status === status) return;
    await patch.mutateAsync({ id: task.id, input: { status } });
  }

  return {
    create,
    createFromText,
    patch,
    remove,
    reorder,
    createList,
    patchList,
    deleteList,
    reorderLists,
    createTag,
    complete,
    undoComplete,
    setPriority,
    setStatus,
    invalidate,
  };
}
