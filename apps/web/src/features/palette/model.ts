import type { List, SearchResults } from '@vital/dto';
import { HOME_PATH, t } from '@/copy';
import { userLists } from '@/features/todos/model';

export type PaletteKind = 'goto' | 'list' | 'task' | 'outcome' | 'inbox';

export type PaletteItem = {
  id: string;
  kind: PaletteKind;
  title: string;
  hint: string;
  href: string;
};

/** Window event that opens the command palette (rail search button dispatches it). */
export const OPEN_PALETTE_EVENT = 'vital:open-palette';

export function isPaletteToggle(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  return event.key === 'k' || event.key === 'K' || event.code === 'KeyK';
}

export function commandItems(): PaletteItem[] {
  return [
    { id: 'goto-today', kind: 'goto', title: t.lists.today, hint: t.palette.goto, href: HOME_PATH },
    {
      id: 'goto-inbox-list',
      kind: 'goto',
      title: t.lists.inbox,
      hint: t.palette.goto,
      href: '/todos/lists/smart:inbox',
    },
    { id: 'goto-later', kind: 'goto', title: t.nav.inbox, hint: t.palette.goto, href: '/inbox' },
    { id: 'goto-daily', kind: 'goto', title: t.reports.daily, hint: t.palette.goto, href: '/reports' },
    {
      id: 'goto-weekly',
      kind: 'goto',
      title: t.reports.weekly,
      hint: t.palette.goto,
      href: '/reports?type=weekly',
    },
    {
      id: 'goto-monthly',
      kind: 'goto',
      title: t.reports.monthly,
      hint: t.palette.goto,
      href: '/reports?type=monthly',
    },
    {
      id: 'goto-yearly',
      kind: 'goto',
      title: t.reports.yearly,
      hint: t.palette.goto,
      href: '/reports?type=yearly',
    },
    { id: 'goto-search', kind: 'goto', title: t.nav.search, hint: t.palette.goto, href: '/search' },
    { id: 'goto-board', kind: 'goto', title: t.palette.board, hint: t.palette.goto, href: '/todos/board' },
    {
      id: 'goto-calendar',
      kind: 'goto',
      title: t.palette.calendar,
      hint: t.palette.goto,
      href: '/todos/calendar',
    },
    { id: 'goto-settings', kind: 'goto', title: t.nav.settings, hint: t.palette.goto, href: '/settings' },
  ];
}

export function listItems(lists: List[]): PaletteItem[] {
  return userLists(lists).map((list) => ({
    id: `list-${list.id}`,
    kind: 'list' as const,
    title: list.name,
    hint: t.palette.list,
    href: `/todos/lists/${list.id}`,
  }));
}

/** Meili 全局快搜结果 → 面板条目，按 任务/线程/收集箱 顺序排列。 */
export function searchResultsToItems(results: SearchResults): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const task of results.tasks) {
    out.push({
      id: `task-${task.id}`,
      kind: 'task',
      title: task.title,
      hint: t.palette.task,
      href: `/todos/lists/${task.listId}?task=${task.id}`,
    });
  }
  for (const outcome of results.outcomes) {
    out.push({
      id: `outcome-${outcome.id}`,
      kind: 'outcome',
      title: outcome.name,
      hint: t.palette.outcome,
      href: `/today/threads/${outcome.id}`,
    });
  }
  for (const item of results.inbox) {
    out.push({
      id: `inbox-${item.id}`,
      kind: 'inbox',
      title: item.title,
      hint: t.palette.inbox,
      href: `/inbox/${item.id}`,
    });
  }
  return out;
}

/** Section header label for search-hit groups; commands stay ungrouped. */
export function groupLabelOf(kind: PaletteKind): string | null {
  if (kind === 'task') return t.palette.task;
  if (kind === 'outcome') return t.palette.outcome;
  if (kind === 'inbox') return t.palette.inbox;
  return null;
}

export function filterItems(items: PaletteItem[], q: string): PaletteItem[] {
  const needle = q.trim().toLowerCase();
  if (needle === '') return items;
  return items.filter(
    (item) => item.title.toLowerCase().includes(needle) || item.hint.toLowerCase().includes(needle),
  );
}

export function mergePalette(commands: PaletteItem[], hits: PaletteItem[]): PaletteItem[] {
  const seen = new Set<string>();
  const out: PaletteItem[] = [];
  for (const item of [...commands, ...hits]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
