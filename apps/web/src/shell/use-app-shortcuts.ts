import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useService } from '@rabjs/react';
import { InboxUiService } from '@/features/inbox';
import { OPEN_PALETTE_EVENT, TOGGLE_PALETTE_EVENT } from '@/features/palette/model';
import { QUICK_ADD_ID, TodosUiService, focusById } from '@/features/todos';
import { HOME_PATH, TODOS_HOME_PATH } from '@/routes';
import { isDesktopHost } from '@/host';
import {
  CHORD_MS,
  isComposingEvent,
  isListFilterPath,
  isSearchPath,
  isShortcutLayerBlocked,
  isTypingTarget,
  planGlobalKey,
  SEARCH_INPUT_ID,
} from '@/shell/shortcut-guard';
import { closeTopShortcutLayer, pushShortcutLayer, runUndoComplete } from '@/shell/shortcut-layer';
import { isMenuShortcut, MENU_SHORTCUT_EVENT, OPEN_SHORTCUTS_EVENT } from '@/shell/shortcuts';

function openShortcuts(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT));
}

function openPalette(): void {
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
}

function togglePalette(): void {
  window.dispatchEvent(new CustomEvent(TOGGLE_PALETTE_EVENT));
}

export function useAppShortcuts(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const todos = useService(TodosUiService);
  const inbox = useService(InboxUiService);
  const pathRef = useRef(location.pathname);
  const chordUntil = useRef(0);
  const detailOpen = todos.detailOpen;

  useEffect(() => {
    pathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    if (!detailOpen) return;
    return pushShortcutLayer(() => todos.closeDetail());
  }, [detailOpen, todos]);

  useEffect(() => {
    function undoIfIdle(): boolean {
      const live = todos.completeUndo;
      if (!live || live.wantUndo) return false;
      if (isTypingTarget(document.activeElement)) return false;
      return runUndoComplete();
    }

    window.__VITAL_CLOSE_LAYER__ = closeTopShortcutLayer;
    window.__VITAL_UNDO_COMPLETE__ = undoIfIdle;

    function onMenu(event: Event): void {
      const action = (event as CustomEvent<unknown>).detail;
      if (!isMenuShortcut(action)) return;
      if (action === 'new-task') {
        const path = pathRef.current;
        todos.requestQuickAdd();
        if (path === HOME_PATH || path.startsWith('/todos')) {
          focusById(QUICK_ADD_ID);
          return;
        }
        navigate(HOME_PATH);
        return;
      }
      if (action === 'new-inbox') {
        inbox.requestPaste();
        if (!pathRef.current.startsWith('/inbox')) navigate('/inbox');
        return;
      }
      if (action === 'palette' || action === 'find') {
        togglePalette();
        return;
      }
      if (action === 'shortcuts') {
        openShortcuts();
        return;
      }
      if (action === 'settings') {
        navigate('/settings');
        return;
      }
      if (action === 'go-today') navigate(HOME_PATH);
      if (action === 'go-todos') navigate(TODOS_HOME_PATH);
      if (action === 'go-inbox') navigate('/inbox');
      if (action === 'go-habits') navigate('/habits');
      if (action === 'go-reports') navigate('/reports');
      if (action === 'go-days') navigate('/days');
    }

    function onKey(event: KeyboardEvent): void {
      const pending = Date.now() < chordUntil.current;
      const plan = planGlobalKey({
        key: event.key,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        typing: isTypingTarget(event.target),
        blocked: isShortcutLayerBlocked(),
        composing: isComposingEvent(event),
        repeat: event.repeat,
        chordPending: pending,
        listFilterPath: isListFilterPath(pathRef.current),
        searchPage: isSearchPath(pathRef.current),
        desktop: isDesktopHost(),
      });
      if (pending) chordUntil.current = 0;
      if (plan.type === 'none') return;
      if (plan.type === 'undo') {
        if (!undoIfIdle()) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (plan.type === 'start-chord') {
        chordUntil.current = Date.now() + CHORD_MS;
        return;
      }
      if (plan.type === 'go') {
        navigate(plan.to);
        return;
      }
      if (plan.type === 'help') {
        openShortcuts();
        return;
      }
      if (plan.type === 'find') {
        togglePalette();
        return;
      }
      if (plan.type === 'focus-search') {
        document.getElementById(SEARCH_INPUT_ID)?.focus();
        return;
      }
      openPalette();
    }

    window.addEventListener(MENU_SHORTCUT_EVENT, onMenu);
    window.addEventListener('keydown', onKey, true);
    return () => {
      delete window.__VITAL_CLOSE_LAYER__;
      delete window.__VITAL_UNDO_COMPLETE__;
      window.removeEventListener(MENU_SHORTCUT_EVENT, onMenu);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [inbox, navigate, todos]);
}
