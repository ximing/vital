import type { Task } from '@vital/dto';
import { create } from 'zustand';
import { UNDO_COMPLETE_MS, type BoardMode } from './model';

export type CompleteUndo = {
  taskId: string;
  title: string;
  completionId: string | null;
  wantUndo: boolean;
};

type TodosUi = {
  selectedId: string | null;
  detailOpen: boolean;
  listFilter: string;
  filterFocusNonce: number;
  quickAddNonce: number;
  boardMode: BoardMode;
  completeUndo: CompleteUndo | null;
  completingIds: string[];
  lastCompletionId: Record<string, string>;
  setSelected: (id: string | null) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  setListFilter: (q: string) => void;
  requestFilterFocus: () => void;
  requestQuickAdd: () => void;
  setBoardMode: (mode: BoardMode) => void;
  startComplete: (task: Task) => void;
  setCompletionId: (taskId: string, completionId: string) => void;
  markWantUndo: () => void;
  finishUndo: () => void;
  failComplete: () => void;
  dismissUndo: () => void;
};

const initial = {
  selectedId: null as string | null,
  detailOpen: false,
  listFilter: '',
  filterFocusNonce: 0,
  quickAddNonce: 0,
  boardMode: 'status' as BoardMode,
  completeUndo: null as CompleteUndo | null,
  completingIds: [] as string[],
  lastCompletionId: {} as Record<string, string>,
};

let undoTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimer(): void {
  if (undoTimer !== null) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
}

function withoutId(ids: string[], id: string): string[] {
  return ids.filter((item) => item !== id);
}

export const useTodosUi = create<TodosUi>((set, get) => ({
  ...initial,
  setSelected: (id) => set({ selectedId: id }),
  openDetail: (id) => set({ selectedId: id, detailOpen: true }),
  closeDetail: () => set({ detailOpen: false }),
  setListFilter: (q) => set({ listFilter: q }),
  requestFilterFocus: () => set((s) => ({ filterFocusNonce: s.filterFocusNonce + 1 })),
  requestQuickAdd: () => set((s) => ({ quickAddNonce: s.quickAddNonce + 1 })),
  setBoardMode: (mode) => set({ boardMode: mode }),
  startComplete: (task) => {
    clearTimer();
    const prev = get().completeUndo;
    const completingIds = withoutId(get().completingIds, prev?.taskId ?? '');
    completingIds.push(task.id);
    set({
      completingIds,
      completeUndo: { taskId: task.id, title: task.title, completionId: null, wantUndo: false },
    });
    undoTimer = setTimeout(() => {
      const live = get().completeUndo;
      if (live && live.taskId === task.id && !live.wantUndo) get().dismissUndo();
    }, UNDO_COMPLETE_MS);
  },
  setCompletionId: (taskId, completionId) => {
    const live = get().completeUndo;
    const lastCompletionId = { ...get().lastCompletionId, [taskId]: completionId };
    if (live?.taskId === taskId) {
      set({ completeUndo: { ...live, completionId }, lastCompletionId });
    } else {
      set({ lastCompletionId });
    }
  },
  markWantUndo: () => {
    const live = get().completeUndo;
    if (!live) return;
    set({
      completeUndo: { ...live, wantUndo: true },
      completingIds: withoutId(get().completingIds, live.taskId),
    });
  },
  finishUndo: () => {
    const live = get().completeUndo;
    clearTimer();
    set({
      completeUndo: null,
      completingIds: live ? withoutId(get().completingIds, live.taskId) : get().completingIds,
    });
  },
  failComplete: () => {
    const live = get().completeUndo;
    clearTimer();
    set({
      completeUndo: null,
      completingIds: live ? withoutId(get().completingIds, live.taskId) : get().completingIds,
    });
  },
  dismissUndo: () => {
    const live = get().completeUndo;
    clearTimer();
    set({
      completeUndo: null,
      completingIds: live ? withoutId(get().completingIds, live.taskId) : get().completingIds,
    });
  },
}));

export function resetTodosUi(): void {
  clearTimer();
  useTodosUi.setState({ ...initial });
}
