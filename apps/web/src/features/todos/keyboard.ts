import type { Task, TaskPriority } from '@vital/dto';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { HOME_PATH } from '@/copy';
import { useTodosUi } from './ui-store';

export const QUICK_ADD_ID = 'todo-quick-add';
export const LIST_FILTER_ID = 'todo-list-filter';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return target.closest('[contenteditable="true"], [contenteditable=""]') !== null;
}

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
}): void {
  const navigate = useNavigate();
  const setSelected = useTodosUi((s) => s.setSelected);
  const openDetail = useTodosUi((s) => s.openDetail);
  const requestQuickAdd = useTodosUi((s) => s.requestQuickAdd);
  const requestFilterFocus = useTodosUi((s) => s.requestFilterFocus);

  const visibleRef = useRef(opts.visibleIds);
  const selectedRef = useRef(opts.selected);
  const completeRef = useRef(opts.onComplete);
  const undoRef = useRef(opts.onUndo);
  const priorityRef = useRef(opts.onPriority);

  useEffect(() => {
    visibleRef.current = opts.visibleIds;
    selectedRef.current = opts.selected;
    completeRef.current = opts.onComplete;
    undoRef.current = opts.onUndo;
    priorityRef.current = opts.onPriority;
  }, [opts.visibleIds, opts.selected, opts.onComplete, opts.onUndo, opts.onPriority]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const undo = useTodosUi.getState().completeUndo;
      const toastLive = undo !== null && !undo.wantUndo;

      if (event.key === 'n') {
        event.preventDefault();
        requestQuickAdd();
        focusById(QUICK_ADD_ID);
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        requestFilterFocus();
        focusById(LIST_FILTER_ID);
        return;
      }
      if (event.key === 't') {
        event.preventDefault();
        navigate(HOME_PATH);
        return;
      }
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const next = moveSelection(
          visibleRef.current,
          useTodosUi.getState().selectedId,
          event.key === 'j' ? 1 : -1,
        );
        setSelected(next);
        return;
      }
      if (event.key === 'Enter') {
        const id = useTodosUi.getState().selectedId;
        if (id === null) return;
        event.preventDefault();
        openDetail(id);
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
  }, [navigate, openDetail, requestFilterFocus, requestQuickAdd, setSelected]);
}
