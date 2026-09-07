import type { Task } from '@vital/dto';

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? '';
}

export function formatDay(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

export function formatHm(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = String(Number(part(parts, 'hour')) % 24).padStart(2, '0');
  return `${hour}:${part(parts, 'minute')}`;
}

export function toDatetimeLocal(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const hour = String(Number(part(parts, 'hour')) % 24).padStart(2, '0');
  return `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}T${hour}:${part(parts, 'minute')}`;
}

export function zonedWallTimeIso(ymd: string, time: string, timeZone: string): string {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  const [hourRaw, minuteRaw, secondRaw] = time.split(':');
  const wallAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    Number(hourRaw ?? '0'),
    Number(minuteRaw ?? '0'),
    Number(secondRaw ?? '0'),
  );
  let utcMs = wallAsUtc - zoneOffsetMs(new Date(wallAsUtc), timeZone);
  utcMs = wallAsUtc - zoneOffsetMs(new Date(utcMs), timeZone);
  return new Date(utcMs).toISOString();
}

export function fromDatetimeLocal(value: string, timeZone: string): string {
  const [ymd, clock] = value.split('T');
  if (ymd === undefined || clock === undefined) return value;
  const time = clock.length === 5 ? `${clock}:00` : clock;
  return zonedWallTimeIso(ymd, time, timeZone);
}

export function addDaysYmdStamp(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function formatHumanDay(ymd: string, timeZone: string, now = new Date()): string {
  if (ymd === '') return '';
  const today = localDateStamp(timeZone, now);
  if (ymd === today) return '今天';
  if (ymd === addDaysYmdStamp(today, 1)) return '明天';
  if (ymd === addDaysYmdStamp(today, -1)) return '昨天';
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(5, 7));
  const day = Number(ymd.slice(8, 10));
  if (String(year) === today.slice(0, 4)) return `${month}月${day}日`;
  return `${year}年${month}月${day}日`;
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
  return zonedWallTimeIso(ymd, '00:00:00', timeZone);
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
