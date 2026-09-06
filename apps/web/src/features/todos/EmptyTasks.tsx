import { t } from '@/copy';
import { EmptyArt } from '@/ui/empty-art';
import { emptyCopyKey } from './model';
import { useTodosUi } from './todos-ui.service';
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
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <EmptyArt />
      <p className="max-w-md text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
        {copy}
      </p>
      {showAction ? (
        <button
          type="button"
          className="mt-5 inline-flex min-h-[var(--touch-min)] items-center rounded-2xl bg-accent px-4 font-medium text-on-accent transition-[background-color] duration-[var(--ease-out)] hover:bg-accent-hover"
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
    <div className="flex flex-col gap-3 px-3 py-6" aria-busy="true" aria-label={t.todos.loading}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton-pulse h-11 rounded-2xl" />
      ))}
    </div>
  );
}
