import { t } from '@/copy';
import { modKey } from '@/shell/shortcut-guard';

export const OPEN_SHORTCUTS_EVENT = 'vital:open-shortcuts';
export const MENU_SHORTCUT_EVENT = 'vital:menu';

export type MenuShortcut =
  | 'new-task'
  | 'new-inbox'
  | 'palette'
  | 'find'
  | 'shortcuts'
  | 'settings'
  | 'go-today'
  | 'go-todos'
  | 'go-inbox'
  | 'go-habits'
  | 'go-reports'
  | 'go-days'
  | 'agent';

export const MENU_SHORTCUTS: readonly MenuShortcut[] = [
  'new-task',
  'new-inbox',
  'palette',
  'find',
  'shortcuts',
  'settings',
  'go-today',
  'go-todos',
  'go-inbox',
  'go-habits',
  'go-reports',
  'go-days',
  'agent',
];

export function isMenuShortcut(value: unknown): value is MenuShortcut {
  return typeof value === 'string' && (MENU_SHORTCUTS as readonly string[]).includes(value);
}

export type ShortcutRow = { label: string; keys: string[] };
export type ShortcutGroup = { id: string; title: string; rows: ShortcutRow[] };

function combo(mod: string, key: string): string {
  return mod === '⌘' ? `${mod}${key}` : `${mod}+${key}`;
}

export function shortcutGroups(mod = modKey()): ShortcutGroup[] {
  const del = mod === '⌘' ? '⌘⌫' : `${mod}+⌫`;
  const shiftN = mod === '⌘' ? '⌘⇧N' : `${mod}+Shift+N`;
  return [
    {
      id: 'list',
      title: t.shortcuts.list,
      rows: [
        { label: t.shortcuts.down, keys: ['j', '↓'] },
        { label: t.shortcuts.up, keys: ['k', '↑'] },
        { label: t.shortcuts.openItem, keys: ['Enter', '→'] },
        { label: t.shortcuts.closeLayer, keys: ['Esc', '←'] },
        { label: t.shortcuts.create, keys: ['n'] },
      ],
    },
    {
      id: 'task',
      title: t.shortcuts.task,
      rows: [
        { label: t.shortcuts.complete, keys: ['e'] },
        { label: t.shortcuts.priority, keys: ['1–4'] },
        { label: t.shortcuts.schedule, keys: ['s'] },
        { label: t.shortcuts.pin, keys: ['p'] },
        { label: t.shortcuts.move, keys: ['m'] },
        { label: t.shortcuts.delete, keys: [del] },
        { label: t.shortcuts.undo, keys: [combo(mod, 'Z')] },
        { label: t.shortcuts.filter, keys: ['/'] },
        { label: t.shortcuts.gotoToday, keys: ['t'] },
      ],
    },
    {
      id: 'inbox',
      title: t.shortcuts.inbox,
      rows: [
        { label: t.shortcuts.paste, keys: ['n'] },
        { label: t.shortcuts.favorite, keys: ['f'] },
        { label: t.shortcuts.archive, keys: ['a'] },
        { label: t.shortcuts.convert, keys: ['c'] },
        { label: t.shortcuts.delete, keys: [del] },
      ],
    },
    {
      id: 'days',
      title: t.shortcuts.days,
      rows: [{ label: t.shortcuts.newDay, keys: ['n'] }],
    },
    {
      id: 'go',
      title: t.shortcuts.go,
      rows: [
        { label: t.shortcuts.goToday, keys: ['g t'] },
        { label: t.shortcuts.goTodos, keys: ['g l'] },
        { label: t.shortcuts.goInbox, keys: ['g i'] },
        { label: t.shortcuts.goHabits, keys: ['g h'] },
        { label: t.shortcuts.goReports, keys: ['g r'] },
        { label: t.shortcuts.goDays, keys: ['g d'] },
        { label: t.shortcuts.goSettings, keys: ['g s'] },
        { label: t.shortcuts.palette, keys: [combo(mod, 'K')] },
        { label: t.shortcuts.paletteSlash, keys: ['/'] },
      ],
    },
    {
      id: 'search',
      title: t.shortcuts.search,
      rows: [
        { label: t.shortcuts.searchOpen, keys: [combo(mod, 'F'), combo(mod, 'K')] },
        { label: t.shortcuts.searchFocus, keys: ['/'] },
        { label: t.shortcuts.down, keys: ['j', '↓'] },
        { label: t.shortcuts.up, keys: ['k', '↑'] },
        { label: t.shortcuts.openItem, keys: ['Enter'] },
        { label: t.shortcuts.searchClear, keys: ['Esc'] },
      ],
    },
    {
      id: 'other',
      title: t.shortcuts.other,
      rows: [
        { label: t.shortcuts.help, keys: ['?'] },
        { label: t.shortcuts.agent, keys: [combo(mod, 'J')] },
        { label: t.shortcuts.saveReport, keys: [combo(mod, 'S')] },
      ],
    },
    {
      id: 'desktop',
      title: t.shortcuts.desktop,
      rows: [
        { label: t.shortcuts.newTask, keys: [combo(mod, 'N')] },
        { label: t.shortcuts.newInbox, keys: [shiftN] },
        { label: t.shortcuts.goSections, keys: [combo(mod, '1–6')] },
        { label: t.shortcuts.closeWindow, keys: [combo(mod, 'W')] },
        { label: t.shortcuts.desktopSettings, keys: [combo(mod, ',')] },
        { label: t.shortcuts.desktopHelp, keys: [combo(mod, '/')] },
        { label: t.shortcuts.agent, keys: [combo(mod, 'J')] },
      ],
    },
  ];
}
