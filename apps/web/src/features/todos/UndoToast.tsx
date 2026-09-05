import { t } from '@/copy';
import { useTodosUi } from './ui-store';

export function UndoToast({ onUndo }: { onUndo: () => void }) {
  const undo = useTodosUi((s) => s.completeUndo);
  if (undo === null || undo.wantUndo) return null;

  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-[var(--z-toast)] flex -translate-x-1/2 items-center gap-3 rounded-md bg-surface px-4 py-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg shadow-[var(--shadow)]"
    >
      <span>
        {t.todos.undoComplete}「{undo.title}」
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
}
