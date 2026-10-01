import { describe, expect, it } from 'vitest';
import { t } from '@/copy';
import { HOME_PATH, TODOS_HOME_PATH } from '@/routes';
import {
  chordDestination,
  isListFilterPath,
  isShortcutLayerBlocked,
  planGlobalKey,
  type GlobalKeyInput,
} from '../../src/shell/shortcut-guard';
import { shortcutGroups } from '../../src/shell/shortcuts';

function key(overrides: Partial<GlobalKeyInput> = {}): GlobalKeyInput {
  return {
    key: 'g',
    meta: false,
    ctrl: false,
    alt: false,
    shift: false,
    typing: false,
    blocked: false,
    composing: false,
    repeat: false,
    chordPending: false,
    listFilterPath: false,
    searchPage: false,
    desktop: false,
    ...overrides,
  };
}

describe('shortcut chords', () => {
  it('maps g-letters onto the primary sections', () => {
    expect(chordDestination('t')).toBe(HOME_PATH);
    expect(chordDestination('l')).toBe(TODOS_HOME_PATH);
    expect(chordDestination('i')).toBe('/inbox');
    expect(chordDestination('h')).toBe('/habits');
    expect(chordDestination('r')).toBe('/reports');
    expect(chordDestination('d')).toBe('/days');
    expect(chordDestination('s')).toBe('/settings');
    expect(chordDestination('x')).toBeNull();
  });

  it('starts a chord on g and follows it within the window', () => {
    expect(planGlobalKey(key())).toEqual({ type: 'start-chord' });
    expect(planGlobalKey(key({ key: 'i', chordPending: true }))).toEqual({ type: 'go', to: '/inbox' });
    expect(planGlobalKey(key({ key: 's', chordPending: true, listFilterPath: true }))).toEqual({
      type: 'go',
      to: '/settings',
    });
  });

  it('lets a non-chord second key through and ignores typing', () => {
    expect(planGlobalKey(key({ key: 'n', chordPending: true }))).toEqual({ type: 'none' });
    expect(planGlobalKey(key({ typing: true }))).toEqual({ type: 'none' });
    expect(planGlobalKey(key({ key: 'i', chordPending: true, typing: true }))).toEqual({ type: 'none' });
    expect(planGlobalKey(key({ blocked: true }))).toEqual({ type: 'none' });
    expect(planGlobalKey(key({ composing: true }))).toEqual({ type: 'none' });
  });

  it('opens help and the palette only outside the list filter', () => {
    expect(planGlobalKey(key({ key: '?' }))).toEqual({ type: 'help' });
    expect(planGlobalKey(key({ key: '/', listFilterPath: false }))).toEqual({ type: 'palette' });
    expect(planGlobalKey(key({ key: '/', listFilterPath: true }))).toEqual({ type: 'none' });
    expect(planGlobalKey(key({ key: '/', searchPage: true }))).toEqual({ type: 'focus-search' });
    expect(planGlobalKey(key({ key: 'f', meta: true }))).toEqual({ type: 'find' });
    expect(planGlobalKey(key({ key: 'f', ctrl: true }))).toEqual({ type: 'find' });
    expect(planGlobalKey(key({ key: 'f', meta: true, typing: true }))).toEqual({ type: 'none' });
    expect(planGlobalKey(key({ key: 'f', meta: true, desktop: true }))).toEqual({ type: 'none' });
    expect(isListFilterPath('/today')).toBe(true);
    expect(isListFilterPath('/todos/lists/smart:today')).toBe(true);
    expect(isListFilterPath('/today/threads/1')).toBe(false);
    expect(isListFilterPath('/inbox')).toBe(false);
  });

  it('undoes with ⌘Z in the browser and leaves that key to the desktop menu', () => {
    expect(planGlobalKey(key({ key: 'z', meta: true }))).toEqual({ type: 'undo' });
    expect(planGlobalKey(key({ key: 'z', ctrl: true }))).toEqual({ type: 'undo' });
    expect(planGlobalKey(key({ key: 'z', meta: true, typing: true }))).toEqual({ type: 'none' });
    expect(planGlobalKey(key({ key: 'z', meta: true, desktop: true }))).toEqual({ type: 'none' });
  });

  it('toggles the agent with ⌘J outside of a text field', () => {
    expect(planGlobalKey(key({ key: 'j', meta: true }))).toEqual({ type: 'agent' });
    expect(planGlobalKey(key({ key: 'J', ctrl: true }))).toEqual({ type: 'agent' });
    expect(planGlobalKey(key({ key: 'j', meta: true, typing: true }))).toEqual({ type: 'none' });
    expect(planGlobalKey(key({ key: 'j', meta: true, desktop: true }))).toEqual({ type: 'none' });
    expect(planGlobalKey(key({ key: 'j' }))).toEqual({ type: 'none' });
  });

  it('ignores a primary layer dialog and still blocks menus', () => {
    document.body.innerHTML = '<div role="dialog" data-shortcut-layer="true"></div>';
    expect(isShortcutLayerBlocked()).toBe(false);
    document.body.innerHTML = '<div role="menu"></div>';
    expect(isShortcutLayerBlocked()).toBe(true);
    document.body.innerHTML = '';
  });

  it('lists the cheatsheet groups', () => {
    const titles = shortcutGroups('⌘').map((group) => group.title);
    expect(titles).toEqual([
      t.shortcuts.list,
      t.shortcuts.task,
      t.shortcuts.inbox,
      t.shortcuts.days,
      t.shortcuts.go,
      t.shortcuts.search,
      t.shortcuts.other,
      t.shortcuts.desktop,
    ]);
    const task = shortcutGroups('⌘').find((group) => group.id === 'task');
    expect(task?.rows.map((row) => row.keys[0])).toContain('s');
    expect(shortcutGroups('Ctrl').find((group) => group.id === 'desktop')?.rows[0]?.keys).toEqual([
      'Ctrl+N',
    ]);
  });
});
