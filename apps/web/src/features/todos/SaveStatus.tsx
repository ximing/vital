import { t } from '@/copy';

export type SaveState = 'idle' | 'editing' | 'saving' | 'saved' | 'error';

export function SaveStatus({
  state,
  savedAt,
  onRetry,
}: {
  state: SaveState;
  savedAt: Date | null;
  onRetry: () => void;
}) {
  if (state === 'idle') return null;
  const hm = savedAt
    ? `${String(savedAt.getHours()).padStart(2, '0')}:${String(savedAt.getMinutes()).padStart(2, '0')}`
    : '';
  const text =
    state === 'editing'
      ? t.todos.saveEditing
      : state === 'saving'
        ? t.todos.saveSaving
        : state === 'saved'
          ? `${t.todos.saveSaved}${hm === '' ? '' : ` · ${hm}`}`
          : `${t.todos.saveFailed} · ${t.todos.retry}`;
  const color =
    state === 'error' ? 'text-danger' : state === 'saved' ? 'text-done' : 'text-tertiary';
  if (state === 'error') {
    return (
      <button
        type="button"
        data-region="save-status"
        data-state={state}
        onClick={onRetry}
        className={`shrink-0 rounded-md px-1.5 py-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] transition-[background-color] duration-[var(--ease-out)] hover:bg-surface-muted ${color}`}
      >
        {text}
      </button>
    );
  }
  return (
    <span
      data-region="save-status"
      data-state={state}
      aria-live="polite"
      className={`shrink-0 px-1.5 py-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] ${color}`}
    >
      {text}
    </span>
  );
}
