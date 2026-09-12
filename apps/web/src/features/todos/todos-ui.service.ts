import { resolve, Service } from '@rabjs/react';
import type { AgentAction, Task } from '@vital/dto';
import { UNDO_COMPLETE_MS, type BoardMode } from './model';

export type DraftJobStatus = 'idle' | 'queued' | 'failed';

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
  /** Per-task agent draft job, survives closing the detail pane. */
  draftStatus: Record<string, DraftJobStatus> = {};
  draftPolled: Record<string, AgentAction | null> = {};
  draftError: Record<string, string | null> = {};
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

  draftJobStatus(taskId: string): DraftJobStatus {
    return this.draftStatus[taskId] ?? 'idle';
  }

  draftJobPolled(taskId: string): AgentAction | null {
    return this.draftPolled[taskId] ?? null;
  }

  draftJobError(taskId: string): string | null {
    return this.draftError[taskId] ?? null;
  }

  setDraftJob(
    taskId: string,
    patch: { status?: DraftJobStatus; polled?: AgentAction | null; error?: string | null },
  ): void {
    if (patch.status !== undefined) this.draftStatus = { ...this.draftStatus, [taskId]: patch.status };
    if (patch.polled !== undefined) this.draftPolled = { ...this.draftPolled, [taskId]: patch.polled };
    if (patch.error !== undefined) this.draftError = { ...this.draftError, [taskId]: patch.error };
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
    this.draftStatus = {};
    this.draftPolled = {};
    this.draftError = {};
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

export function resetTodosUi(): void {
  todosUi().reset();
}
