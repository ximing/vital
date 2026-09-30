import type { AppSection } from '@/shell/section';
import {
  loadDays,
  loadHabits,
  loadInbox,
  loadInboxReader,
  loadNotesEditor,
  loadReportEditor,
  loadReports,
  loadThreads,
  loadToday,
  loadTodos,
} from '@/shell/route-loaders';

export type WarmTarget = 'today' | 'todos' | 'inbox' | 'habits' | 'reports' | 'days' | 'threads';

export type NeighborWarm = 'today' | 'todos' | 'inbox' | 'notes' | 'report-editor';

/** Rail hover target. Settings, usage, memory, and activity stay cold. */
export function warmTarget(path: string): WarmTarget | null {
  const pathname = path.split('?')[0] ?? path;
  if (pathname.startsWith('/today')) return 'today';
  if (pathname.startsWith('/todos')) return 'todos';
  if (pathname.startsWith('/inbox')) return 'inbox';
  if (pathname.startsWith('/habits')) return 'habits';
  if (pathname.startsWith('/reports')) return 'reports';
  if (pathname.startsWith('/days')) return 'days';
  if (pathname.startsWith('/threads')) return 'threads';
  return null;
}

/** Idle warmup after the current section has painted. */
export function neighborWarms(section: AppSection): NeighborWarm[] {
  if (section === 'today') return ['todos', 'inbox', 'notes'];
  if (section === 'todos') return ['today', 'inbox', 'notes'];
  if (section === 'capture') return ['today', 'todos'];
  if (section === 'reflect') return ['report-editor'];
  return [];
}

const started = new Set<string>();

function warm(key: string, load: () => Promise<unknown>): void {
  if (started.has(key)) return;
  started.add(key);
  void load().catch(() => {
    started.delete(key);
  });
}

export function warmPath(path: string): void {
  const target = warmTarget(path);
  if (target === 'today') warm('today', loadToday);
  else if (target === 'todos') warm('todos', loadTodos);
  else if (target === 'inbox') warm('inbox', loadInbox);
  else if (target === 'habits') warm('habits', loadHabits);
  else if (target === 'reports') warm('reports', loadReports);
  else if (target === 'days') warm('days', loadDays);
  else if (target === 'threads') warm('threads', loadThreads);
}

export function warmNeighbors(section: AppSection): void {
  for (const item of neighborWarms(section)) {
    if (item === 'today') warm('today', loadToday);
    else if (item === 'todos') warm('todos', loadTodos);
    else if (item === 'inbox') warm('inbox', loadInbox);
    else if (item === 'notes') warm('notes', loadNotesEditor);
    else warm('report-editor', loadReportEditor);
  }
}

export function warmInboxReader(): void {
  warm('inbox-reader', loadInboxReader);
}

/** Run after first paint. Falls back when the browser has no idle callback. */
export function scheduleIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(() => run(), { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 200);
  return () => window.clearTimeout(id);
}
