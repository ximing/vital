import { resolve, Service, useObserverService } from '@rabjs/react';
import type { Task } from '@vital/dto';
import { UNDO_COMPLETE_MS, type BoardMode } from './model';

export type CompleteUndo = {
  taskId: string;
  title: string;
  completionId: string | null;
  wantUndo: boolean;
};

function withoutId(ids: string[], id: string): string[] {
  return ids.filter((item) => item !== id);
}

export class TodosUiService extends Service {
  selectedId: string | null = null;
  detailOpen = false;
  listFilter = '';
  filterFocusNonce = 0;
  quickAddNonce = 0;
  hideCompleted = true;
  boardMode: BoardMode = 'status';
  completeUndo: CompleteUndo | null = null;
  completingIds: string[] = [];
  lastCompletionId: Record<string, string> = {};
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  openDetail(id: string): void {
    this.selectedId = id;
    this.detailOpen = true;
  }

  closeDetail(): void {
    this.detailOpen = false;
  }

  setListFilter(q: string): void {
    this.listFilter = q;
  }

  requestFilterFocus(): void {
    this.filterFocusNonce += 1;
  }

  requestQuickAdd(): void {
    this.quickAddNonce += 1;
  }

  setHideCompleted(hide: boolean): void {
    this.hideCompleted = hide;
  }

  setBoardMode(mode: BoardMode): void {
    this.boardMode = mode;
  }

  startComplete(task: Task): void {
    this.clearTimer();
    const prev = this.completeUndo;
    const completingIds = withoutId(this.completingIds, prev?.taskId ?? '');
    completingIds.push(task.id);
    this.completingIds = completingIds;
    this.completeUndo = { taskId: task.id, title: task.title, completionId: null, wantUndo: false };
    this.undoTimer = setTimeout(() => {
      const live = this.completeUndo;
      if (live && live.taskId === task.id && !live.wantUndo) this.dismissUndo();
    }, UNDO_COMPLETE_MS);
  }

  setCompletionId(taskId: string, completionId: string): void {
    this.lastCompletionId = { ...this.lastCompletionId, [taskId]: completionId };
    const live = this.completeUndo;
    if (live?.taskId === taskId) {
      this.completeUndo = { ...live, completionId };
    }
  }

  markWantUndo(): void {
    const live = this.completeUndo;
    if (!live) return;
    this.completeUndo = { ...live, wantUndo: true };
    this.completingIds = withoutId(this.completingIds, live.taskId);
  }

  finishUndo(): void {
    const live = this.completeUndo;
    this.clearTimer();
    this.completeUndo = null;
    if (live) this.completingIds = withoutId(this.completingIds, live.taskId);
  }

  failComplete(): void {
    const live = this.completeUndo;
    this.clearTimer();
    this.completeUndo = null;
    if (live) this.completingIds = withoutId(this.completingIds, live.taskId);
  }

  dismissUndo(): void {
    const live = this.completeUndo;
    this.clearTimer();
    this.completeUndo = null;
    if (live) this.completingIds = withoutId(this.completingIds, live.taskId);
  }

  reset(): void {
    this.clearTimer();
    this.selectedId = null;
    this.detailOpen = false;
    this.listFilter = '';
    this.filterFocusNonce = 0;
    this.quickAddNonce = 0;
    this.hideCompleted = true;
    this.boardMode = 'status';
    this.completeUndo = null;
    this.completingIds = [];
    this.lastCompletionId = {};
  }

  private clearTimer(): void {
    if (this.undoTimer !== null) {
      clearTimeout(this.undoTimer);
      this.undoTimer = null;
    }
  }
}

export function todosUi(): TodosUiService {
  return resolve(TodosUiService);
}

export function useTodosUi<T>(selector: (s: TodosUiService) => T): T {
  const [value] = useObserverService(TodosUiService, selector);
  return value;
}

export function resetTodosUi(): void {
  todosUi().reset();
}
