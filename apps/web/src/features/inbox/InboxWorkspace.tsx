import type { Task } from '@vital/dto';
import { useNavigate } from 'react-router';
import { t } from '@/copy';
import { useTasksQuery, useTodoActions } from '@/features/todos/queries';
import { useTodosUi } from '@/features/todos/ui-store';
import { UndoToast } from '@/features/todos/UndoToast';
import { useAuthStore } from '@/state/auth-store';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { InboxList } from './InboxList';
import { unprocessedTodos, visibleSaves } from './model';
import { useOnline } from './online';
import { PasteUrl } from './PasteUrl';
import { useInboxActions, useInboxListQuery } from './queries';
import { useInboxUi } from './ui-store';

export function InboxWorkspace() {
  const navigate = useNavigate();
  const online = useOnline();
  const timeZone = useAuthStore((s) => s.user?.timezone) ?? 'UTC';
  const inboxQuery = useInboxListQuery();
  const tasksQuery = useTasksQuery('smart:inbox');
  const todoActions = useTodoActions();
  const inboxActions = useInboxActions();
  const pending = useInboxUi((s) => s.pending);

  const tasks = unprocessedTodos(tasksQuery.data ?? []);
  const items = visibleSaves(inboxQuery.data ?? []);
  const error = inboxQuery.error ?? tasksQuery.error;

  function openTask(task: Task) {
    useTodosUi.getState().openDetail(task.id);
    navigate('/todos/lists/smart:inbox');
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="px-4 pb-2 pt-6">
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {t.inbox.kicker}
        </p>
        <h1 className="text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em]">
          {t.nav.inbox}
        </h1>
      </header>

      {!online ? (
        <div className="px-4">
          <Banner>{t.todos.offline}</Banner>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-3 px-4 py-2">
          <Banner>{humanError(error)}</Banner>
          <Button
            variant="ghost"
            onClick={() => {
              void inboxQuery.refetch();
              void tasksQuery.refetch();
            }}
          >
            {t.inbox.retry}
          </Button>
        </div>
      ) : null}

      <PasteUrl disabled={!online} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <InboxList
          tasks={tasks}
          tasksLoading={tasksQuery.isLoading}
          items={items}
          itemsLoading={inboxQuery.isLoading}
          pending={pending}
          timeZone={timeZone}
          online={online}
          onOpenTask={openTask}
          onCompleteTask={(task) => void todoActions.complete(task)}
          onRetry={(save) => {
            void inboxActions.retry(save).then((result) => {
              if (result && 'id' in result) navigate(`/inbox/${result.id}`);
            });
          }}
        />
      </div>

      <UndoToast onUndo={() => void todoActions.undoComplete()} />
    </div>
  );
}
