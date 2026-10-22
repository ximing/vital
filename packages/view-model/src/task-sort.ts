import type { Task } from '@vital/dto';

export type TaskNode = { task: Task; children: Task[] };
export type NestedTask = TaskNode;

export type TaskSortKey = 'manual' | 'created' | 'updated' | 'due' | 'title';
export type TaskSortDir = 'asc' | 'desc';
export type TaskSort = { key: TaskSortKey; dir: TaskSortDir };

export const TASK_SORT_KEYS: TaskSortKey[] = ['manual', 'created', 'updated', 'due', 'title'];
/** Drag order. Direction is ignored by `compareTasks`. */
export const MANUAL_TASK_SORT: TaskSort = { key: 'manual', dir: 'asc' };
/** Lists open on last-touched first. */
export const DEFAULT_TASK_SORT: TaskSort = { key: 'updated', dir: 'desc' };

export function defaultTaskSortDir(key: TaskSortKey): TaskSortDir {
  return key === 'created' || key === 'updated' ? 'desc' : 'asc';
}

export function compareTasks(a: Task, b: Task, sort: TaskSort): number {
  const dir = sort.dir === 'asc' ? 1 : -1;
  let cmp = 0;
  switch (sort.key) {
    case 'manual':
      return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
    case 'created':
      cmp = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      break;
    case 'updated':
      cmp = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
      break;
    case 'due': {
      const left = a.dueAt === null ? null : Date.parse(a.dueAt);
      const right = b.dueAt === null ? null : Date.parse(b.dueAt);
      if (left === null && right === null) cmp = 0;
      else if (left === null) cmp = 1;
      else if (right === null) cmp = -1;
      else cmp = left - right;
      break;
    }
    case 'title':
      cmp = a.title.localeCompare(b.title, 'zh');
      break;
  }
  return cmp * dir || a.id.localeCompare(b.id);
}

export function nestTasks(tasks: Task[], sort: TaskSort = DEFAULT_TASK_SORT): TaskNode[] {
  const ids = new Set(tasks.map((item) => item.id));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];
  const sorted = [...tasks].sort((a, b) => compareTasks(a, b, sort));
  for (const task of sorted) {
    if (task.parentId && ids.has(task.parentId)) {
      const list = children.get(task.parentId) ?? [];
      list.push(task);
      children.set(task.parentId, list);
    } else {
      roots.push(task);
    }
  }
  return roots.map((task) => ({ task, children: children.get(task.id) ?? [] }));
}
