import { HOME_PATH, TODOS_HOME_PATH } from '@/routes';

/** Shared key guards for list shortcuts and the global chord handler. */

export const CHORD_MS = 1000;

export const CHORD_DESTINATIONS = {
  t: HOME_PATH,
  l: TODOS_HOME_PATH,
  i: '/inbox',
  h: '/habits',
  r: '/reports',
  d: '/days',
  s: '/settings',
} as const;

export type ChordLetter = keyof typeof CHORD_DESTINATIONS;

export const SEARCH_INPUT_ID = 'vital-search-query';

export type GlobalAction =
  | { type: 'none' }
  | { type: 'start-chord' }
  | { type: 'go'; to: string }
  | { type: 'help' }
  | { type: 'palette' }
  | { type: 'find' }
  | { type: 'focus-search' }
  | { type: 'undo' }
  | { type: 'agent' };

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return target.closest('[contenteditable="true"], [contenteditable=""]') !== null;
}

export function isComposingEvent(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/** Menus and popovers swallow list keys. A primary layer marks itself so ← can still close it. */
export function isShortcutLayerBlocked(): boolean {
  if (typeof document === 'undefined') return false;
  const nodes = document.querySelectorAll('[role="dialog"], [role="menu"]');
  for (const node of nodes) {
    if (node.getAttribute('data-shortcut-layer') === 'true') continue;
    return true;
  }
  return false;
}

/** `/` filters the list on 今天 and 待办. Everywhere else it opens the palette. */
export function isListFilterPath(pathname: string): boolean {
  return pathname === '/today' || pathname.startsWith('/todos');
}

export function isSearchPath(pathname: string): boolean {
  return pathname === '/search';
}

export function chordDestination(key: string): string | null {
  const letter = key.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CHORD_DESTINATIONS, letter)) return null;
  return CHORD_DESTINATIONS[letter as ChordLetter];
}

export function isApplePlatform(
  platform = typeof navigator === 'undefined' ? '' : navigator.platform,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS/.test(userAgent);
}

export function modKey(): string {
  return isApplePlatform() ? '⌘' : 'Ctrl';
}

export function deleteShortcutLabel(mod = modKey()): string {
  return mod === '⌘' ? '⌘⌫' : `${mod}+⌫`;
}

export type GlobalKeyInput = {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  typing: boolean;
  blocked: boolean;
  composing: boolean;
  repeat: boolean;
  chordPending: boolean;
  listFilterPath: boolean;
  searchPage: boolean;
  desktop: boolean;
};

export function planGlobalKey(input: GlobalKeyInput): GlobalAction {
  if (input.composing) return { type: 'none' };

  const plain = !input.meta && !input.ctrl && !input.alt;
  const free = plain && !input.typing && !input.blocked;

  if (input.chordPending && free) {
    const to = chordDestination(input.key);
    if (to !== null && !input.shift) return { type: 'go', to };
  }

  if (
    (input.meta || input.ctrl) &&
    !input.alt &&
    !input.shift &&
    !input.typing &&
    !input.blocked &&
    !input.desktop &&
    (input.key === 'z' || input.key === 'Z')
  ) {
    return { type: 'undo' };
  }

  if (
    (input.meta || input.ctrl) &&
    !input.alt &&
    !input.shift &&
    !input.typing &&
    !input.blocked &&
    !input.desktop &&
    (input.key === 'f' || input.key === 'F')
  ) {
    return { type: 'find' };
  }

  if (
    (input.meta || input.ctrl) &&
    !input.alt &&
    !input.shift &&
    !input.typing &&
    !input.blocked &&
    !input.desktop &&
    (input.key === 'j' || input.key === 'J')
  ) {
    return { type: 'agent' };
  }

  if (!free) return { type: 'none' };

  if (input.key === '?' ) return { type: 'help' };
  if (input.key === '/' && !input.shift && !input.listFilterPath) {
    return input.searchPage ? { type: 'focus-search' } : { type: 'palette' };
  }
  if (input.key === 'g' && !input.shift && !input.repeat) return { type: 'start-chord' };
  return { type: 'none' };
}
