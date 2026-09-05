import type {
  CalendarInstance,
  CreateListInput,
  CreateTaskInput,
  List,
  PatchTaskInput,
  Tag,
  Task,
  TaskPriority,
} from '@vital/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { useAuthStore } from '@/state/auth-store';
import { useTodosUi } from './ui-store';

export const todoKeys = {
  all: ['todos'] as const,
  lists: ['todos', 'lists'] as const,
  tags: ['todos', 'tags'] as const,
  tasks: (listId: string) => ['todos', 'tasks', listId] as const,
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

export function useTasksQuery(listId: string, enabled = true) {
  return useQuery({
    queryKey: todoKeys.tasks(listId),
    queryFn: () => fetchAllTasks(listId),
    enabled: enabled && listId !== '',
  });
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
  const invalidate = () => qc.invalidateQueries({ queryKey: todoKeys.all });

  const create = useMutation({
    mutationFn: (input: CreateTaskInput) => client.createTask(input),
    onSuccess: async (task) => {
      await invalidate();
      const user = useAuthStore.getState().user;
      if (user && user.onboarding.createdTask !== true) {
        try {
          const next = await client.updateOnboarding({ createdTask: true });
          useAuthStore.getState().setUser(next);
        } catch {
          // Checklist is best-effort.
        }
      }
      useTodosUi.getState().setSelected(task.id);
    },
  });

  const patch = useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchTaskInput }) =>
      client.patchTask(id, input),
    onSuccess: () => invalidate(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => client.deleteTask(id),
    onSuccess: () => {
      useTodosUi.getState().closeDetail();
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

  const createTag = useMutation({
    mutationFn: (name: string) => client.createTag({ name }),
    onSuccess: () => invalidate(),
  });

  async function complete(task: Task): Promise<void> {
    if (task.status === 'canceled') return;
    if (task.status === 'done' && task.recurrence === null) return;
    const ui = useTodosUi.getState();
    if (ui.completeUndo && !ui.completeUndo.wantUndo && ui.completeUndo.taskId === task.id) {
      await undoComplete();
      return;
    }
    ui.startComplete(task);
    try {
      const res = await client.completeTask(task.id);
      const live = useTodosUi.getState().completeUndo;
      useTodosUi.getState().setCompletionId(task.id, res.undo.completionId);
      if (live?.taskId === task.id && live.wantUndo) {
        await client.uncompleteTask(task.id, { completionId: res.undo.completionId });
        useTodosUi.getState().finishUndo();
      }
      await invalidate();
    } catch (err) {
      useTodosUi.getState().failComplete();
      throw err;
    }
  }

  async function undoComplete(): Promise<void> {
    const live = useTodosUi.getState().completeUndo;
    if (!live) return;
    if (live.completionId === null) {
      useTodosUi.getState().markWantUndo();
      return;
    }
    await client.uncompleteTask(live.taskId, { completionId: live.completionId });
    useTodosUi.getState().finishUndo();
    await invalidate();
  }

  async function setPriority(task: Task, priority: TaskPriority): Promise<void> {
    if (task.priority === priority) return;
    await patch.mutateAsync({ id: task.id, input: { priority } });
  }

  async function setStatus(task: Task, status: 'todo' | 'doing'): Promise<void> {
    if (task.status === 'done') {
      const completionId = useTodosUi.getState().lastCompletionId[task.id];
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
    patch,
    remove,
    reorder,
    createList,
    createTag,
    complete,
    undoComplete,
    setPriority,
    setStatus,
    invalidate,
  };
}
