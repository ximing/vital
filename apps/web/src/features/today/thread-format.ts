import type { OutcomeSignal, Task } from '@vital/dto';
import { t } from '@/copy';

export const SIGNAL_CLASS: Record<OutcomeSignal, string> = {
  up: 'text-accent bg-accent-subtle',
  flat: 'text-tertiary bg-surface-muted',
  alert: 'text-due bg-[var(--amber-100)]',
};

export function formatHmOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

export function taskMeta(task: Task, timeZone: string): string {
  const parts: string[] = [
    task.estimateMinutes !== null && task.estimateMinutes > 0
      ? t.thread.minutes.replace('{n}', String(task.estimateMinutes))
      : t.thread.noEstimate,
  ];
  if (task.dueAt !== null) {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone });
    if (fmt.format(new Date(task.dueAt)) <= fmt.format(new Date())) {
      parts.push(t.thread.dueToday);
    }
  }
  return parts.join('　');
}
