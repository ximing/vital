import type { List, SearchHit } from '@vital/dto';
import { HOME_PATH, t } from '@/copy';
import { userLists } from '@/features/todos/model';

export type PaletteKind = 'goto' | 'list' | 'task' | 'inbox' | 'report';

export type PaletteItem = {
  id: string;
  kind: PaletteKind;
  title: string;
  hint: string;
  href: string;
};

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

export function hitsToItems(hits: SearchHit[]): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const hit of hits) {
    if (hit.type === 'task') {
      out.push({
        id: `task-${hit.task.id}`,
        kind: 'task',
        title: hit.task.title,
        hint: t.palette.task,
        href: `/todos/lists/${hit.task.listId}?task=${hit.task.id}`,
      });
    } else if (hit.type === 'inbox') {
      out.push({
        id: `inbox-${hit.inbox.id}`,
        kind: 'inbox',
        title: hit.inbox.title,
        hint: t.palette.inbox,
        href: `/inbox/${hit.inbox.id}`,
      });
    } else {
      out.push({
        id: `report-${hit.report.id}`,
        kind: 'report',
        title: hit.report.title,
        hint: t.palette.report,
        href: `/reports/${hit.report.id}?type=${hit.report.type}`,
      });
    }
  }
  return out;
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
