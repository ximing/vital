import type { Task, TaskPriority } from '@vital/dto';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useService } from '@rabjs/react';
import { HOME_PATH } from '@/routes';
import {
  isComposingEvent,
  isShortcutLayerBlocked,
  isTypingTarget,
} from '@/shell/shortcut-guard';
import { registerUndoComplete } from '@/shell/shortcut-layer';
import { TodosUiService } from './todos-ui.service';

export const QUICK_ADD_ID = 'todo-quick-add';
export const LIST_FILTER_ID = 'todo-list-filter';

export { isTypingTarget };

export function focusById(id: string): void {
  const el = document.getElementById(id);
  if (el instanceof HTMLElement) el.focus();
}

export function moveSelection(ids: string[], current: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) return null;
  if (current === null) return delta === 1 ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null);
  const idx = ids.indexOf(current);
  if (idx < 0) return delta === 1 ? (ids[0] ?? null) : (ids[ids.length - 1] ?? null);
  const next = idx + delta;
  if (next < 0) return ids[0] ?? null;
  if (next >= ids.length) return ids[ids.length - 1] ?? null;
  return ids[next] ?? null;
}

export function useTodosKeyboard(opts: {
  visibleIds: string[];
  selected: Task | undefined;
  onComplete: (task: Task) => void;
  onUndo: () => void;
  onPriority: (task: Task, priority: TaskPriority) => void;
  onPin: (task: Task) => void;
}): void {
  const navigate = useNavigate();
  const todos = useService(TodosUiService);

  const visibleRef = useRef(opts.visibleIds);
  const selectedRef = useRef(opts.selected);
  const completeRef = useRef(opts.onComplete);
  const undoRef = useRef(opts.onUndo);
  const priorityRef = useRef(opts.onPriority);
  const pinRef = useRef(opts.onPin);

  useEffect(() => {
    visibleRef.current = opts.visibleIds;
    selectedRef.current = opts.selected;
    completeRef.current = opts.onComplete;
    undoRef.current = opts.onUndo;
    priorityRef.current = opts.onPriority;
    pinRef.current = opts.onPin;
  }, [opts.visibleIds, opts.selected, opts.onComplete, opts.onUndo, opts.onPriority, opts.onPin]);

  useEffect(() => registerUndoComplete(() => undoRef.current()), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (isComposingEvent(event) || isShortcutLayerBlocked()) return;

      const deleteChord =
        event.key === 'Backspace' &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey;
      if (deleteChord) {
        const task = selectedRef.current;
        if (!task) return;
        event.preventDefault();
        event.stopPropagation();
        todos.requestDelete(task.id);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const undo = todos.completeUndo;
      const toastLive = undo !== null && !undo.wantUndo;

      if (event.key === 'n') {
        event.preventDefault();
        todos.requestQuickAdd();
        focusById(QUICK_ADD_ID);
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        todos.requestFilterFocus();
        focusById(LIST_FILTER_ID);
        return;
      }
      if (event.key === 't') {
        event.preventDefault();
        navigate(HOME_PATH);
        return;
      }
      if (event.key === 'Escape' || event.key === 'ArrowLeft') {
        if (!todos.detailOpen) return;
        event.preventDefault();
        todos.closeDetail();
        return;
      }
      if (
        event.key === 'j' ||
        event.key === 'k' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp'
      ) {
        event.preventDefault();
        const next = moveSelection(
          visibleRef.current,
          todos.selectedId,
          event.key === 'j' || event.key === 'ArrowDown' ? 1 : -1,
        );
        todos.setSelected(next);
        return;
      }
      if (event.key === 'Enter' || event.key === 'ArrowRight') {
        const id = todos.selectedId;
        if (id === null) return;
        event.preventDefault();
        todos.openDetail(id);
        return;
      }
      if (event.key === 'e') {
        event.preventDefault();
        if (toastLive) {
          undoRef.current();
          return;
        }
        const task = selectedRef.current;
        if (task) completeRef.current(task);
        return;
      }
      if (event.key === 's') {
        const task = selectedRef.current;
        if (!task) return;
        event.preventDefault();
        todos.openDetail(task.id);
        todos.requestSchedule();
        return;
      }
      if (event.key === 'p') {
        const task = selectedRef.current;
        if (!task || task.parentId !== null) return;
        event.preventDefault();
        pinRef.current(task);
        return;
      }
      if (event.key === 'm') {
        const task = selectedRef.current;
        if (!task || task.parentId !== null) return;
        event.preventDefault();
        todos.openMove(task.id);
        return;
      }
      if (event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4') {
        const task = selectedRef.current;
        if (!task) return;
        event.preventDefault();
        const priority = (Number(event.key) - 1) as TaskPriority;
        priorityRef.current(task, priority);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, todos]);
}
