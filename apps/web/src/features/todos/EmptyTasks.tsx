import { VitalMark } from '@/shell/VitalMark';
import { t } from '@/copy';
import { emptyCopyKey } from './model';
import { useTodosUi } from './ui-store';
import { QUICK_ADD_ID, focusById } from './keyboard';

export function EmptyTasks({ listId, kind }: { listId: string; kind: 'list' | 'board' | 'week' }) {
  const requestQuickAdd = useTodosUi((s) => s.requestQuickAdd);
  const copy =
    kind === 'board'
      ? t.empty.board
      : kind === 'week'
        ? t.empty.calendar
        : t.empty[emptyCopyKey(listId)];
  const showAction = !(kind === 'list' && listId === 'smart:done');

  return (
    <div className="flex flex-col items-start px-4 py-16">
      <VitalMark className="mb-4 h-10 w-10 text-accent" />
      <p className="max-w-md text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
        {copy}
      </p>
      {showAction ? (
        <button
          type="button"
          className="mt-5 inline-flex min-h-[var(--touch-min)] items-center rounded-md bg-accent-subtle px-4 text-fg transition-[background-color] duration-[var(--ease-out)] hover:bg-surface-muted"
          onClick={() => {
            requestQuickAdd();
            focusById(QUICK_ADD_ID);
          }}
        >
          {t.empty.actionNew}
        </button>
      ) : null}
    </div>
  );
}

export function TaskSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 py-6" aria-busy="true" aria-label={t.todos.loading}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton-pulse h-11 rounded-md" />
      ))}
    </div>
  );
}
