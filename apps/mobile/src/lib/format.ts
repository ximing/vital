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

function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const num = (type: Intl.DateTimeFormatPartTypes): number => {
    const hit = parts.find((part) => part.type === type);
    return Number(hit?.value ?? '0');
  };
  const asUtc = Date.UTC(
    num('year'),
    num('month') - 1,
    num('day'),
    num('hour'),
    num('minute'),
    num('second'),
  );
  return asUtc - at.getTime();
}

/** UTC ISO of `ymd` 00:00 in `timeZone` (all-day due_at). */
export function zonedLocalMidnightIso(timeZone: string, ymd: string): string {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utcMs = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone);
  utcMs = wallAsUtc - zoneOffsetMs(new Date(utcMs), timeZone);
  return new Date(utcMs).toISOString();
}

export function startOfLocalDayIso(timeZone: string, at = new Date()): string {
  return zonedLocalMidnightIso(timeZone, localDateStamp(timeZone, at));
}

/** Spec §10.1: local-date(due_at) < today in task tz. All-day due today is not overdue. */
export function isOverdue(task: Task, now = new Date()): boolean {
  if (task.dueAt === null) return false;
  if (task.status === 'done' || task.status === 'canceled') return false;
  const tz = task.timezone;
  return localDateStamp(tz, new Date(task.dueAt)) < localDateStamp(tz, now);
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
