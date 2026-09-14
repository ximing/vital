import { observer, useService } from '@rabjs/react';
import type { FC } from 'react';
import { Link } from 'react-router';
import { t } from '@/copy';
import { TodosUiService } from './todos-ui.service';

export const SimilarOpenToast: FC = observer(function SimilarOpenToast() {
  const todos = useService(TodosUiService);
  if (todos.similarOpen.length === 0) return null;

  return (
    <div
      role="status"
      aria-label={t.todos.similarOpenPrefix}
      className="fixed bottom-24 left-1/2 z-[var(--z-toast)] flex max-w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-md bg-surface px-4 py-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg shadow-[var(--shadow)]"
    >
      <span className="min-w-0">
        {t.todos.similarOpenPrefix}
        {todos.similarOpen.map((hit, index) => (
          <span key={hit.id}>
            {index > 0 ? '、' : null}
            <Link
              to={`/todos/lists/smart:inbox?task=${hit.id}`}
              className="text-accent underline-offset-4 hover:underline"
              onClick={() => {
                todos.openDetail(hit.id);
                todos.dismissSimilarOpen();
              }}
            >
              {hit.title}
            </Link>
          </span>
        ))}
      </span>
      <button
        type="button"
        className="min-h-[var(--touch-min)] shrink-0 text-muted hover:text-fg"
        onClick={() => todos.dismissSimilarOpen()}
      >
        {t.todos.similarOpenDismiss}
      </button>
    </div>
  );
});
