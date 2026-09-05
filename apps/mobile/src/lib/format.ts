import type { Task } from '@vital/dto';

export function formatDay(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

export function localDateStamp(timeZone: string, at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

export function startOfLocalDayIso(timeZone: string, at = new Date()): string {
  return `${localDateStamp(timeZone, at)}T00:00:00.000Z`;
}

export function isOverdue(task: Task, now = new Date()): boolean {
  if (task.dueAt === null) return false;
  if (task.status === 'done' || task.status === 'canceled') return false;
  return new Date(task.dueAt).getTime() < now.getTime();
}

export type NestedTask = { task: Task; children: Task[] };

export function nestTasks(items: Task[]): NestedTask[] {
  const byParent = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const task of items) {
    if (task.parentId !== null) {
      const bucket = byParent.get(task.parentId) ?? [];
      bucket.push(task);
      byParent.set(task.parentId, bucket);
    } else {
      roots.push(task);
    }
  }
  return roots.map((task) => ({ task, children: byParent.get(task.id) ?? [] }));
}
