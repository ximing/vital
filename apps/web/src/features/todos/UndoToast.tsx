import { observer, useService } from '@rabjs/react';
import type { FC } from 'react';
import { t } from '@/copy';
import { TodosUiService } from './todos-ui.service';

export const UndoToast: FC<{ onUndo: () => void }> = observer(function UndoToast({ onUndo }) {
  const todos = useService(TodosUiService);
  if (todos.completeUndo === null || todos.completeUndo.wantUndo) return null;

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-[var(--z-toast)] flex -translate-x-1/2 items-center gap-3 rounded-md bg-surface px-4 py-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg shadow-[var(--shadow)]"
    >
      <span>
        {t.todos.undoComplete}「{todos.completeUndo.title}」
      </span>
      <button
        type="button"
        className="min-h-[var(--touch-min)] text-accent"
        onClick={() => onUndo()}
      >
        {t.todos.undo}
      </button>
    </div>
  );
});
