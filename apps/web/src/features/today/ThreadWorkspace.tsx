import type { Task } from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { bindServices, useService } from '@rabjs/react';
import type { FC, ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { t } from '@/copy';
import {
  TaskDetail,
  TaskSkeleton,
  TodosUiService,
  UndoToast,
  useListsQuery,
  useTagsQuery,
  useTodoActions,
} from '@/features/todos';
import { HOME_PATH } from '@/routes';
import { AuthService } from '@/services/auth.service';
import { Button } from '@/ui/button';
import { ThreadAgentLog } from './ThreadAgentLog';
import { ThreadHabits } from './ThreadHabits';
import { ThreadHeader } from './ThreadHeader';
import { ThreadMaterials } from './ThreadMaterials';
import { ThreadNextStep } from './ThreadNextStep';
import { ThreadTasks } from './ThreadTasks';
import { ThreadPageService } from './thread-page.service';
import { useOutcomeDetailQuery, usePendingDecomposeQuery } from './queries';

const DETAIL_COL =
  'flex h-full min-h-0 w-[clamp(24rem,40%,40rem)] shrink-0 border-l border-border/60';

const BACK_LINK_CLASS =
  'mt-4 inline-flex items-center rounded-md px-2 py-1 text-[length:var(--text-meta)] text-muted transition-colors hover:bg-surface-muted hover:text-fg';

function ThreadCanvas({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1000px] px-6 pb-16 md:px-8">{children}</div>
    </main>
  );
}

function ThreadWorkspaceContent() {
  const page = useService(ThreadPageService);
  const todos = useService(TodosUiService);
  const auth = useService(AuthService);
  const { id = '' } = useParams();
  const user = auth.user;
  const timeZone = user?.timezone ?? 'UTC';

  const detailQuery = useOutcomeDetailQuery(id);
  const listsQuery = useListsQuery();
  const tagsQuery = useTagsQuery();
  const todoActions = useTodoActions();

  const selectedId = todos.selectedId;
  const detailOpen = todos.detailOpen;
  const now = page.now;
  const creatingTask = page.creatingTask;

  const detail = detailQuery.data ?? null;
  const tasks = detail?.tasks ?? [];
  const detailTask = detailOpen ? tasks.find((task) => task.id === selectedId) : undefined;
  const decomposeQuery = usePendingDecomposeQuery(
    detailOpen && detailTask && detailTask.parentId === null ? detailTask.id : null,
  );
  const decomposeAction =
    (decomposeQuery.data ?? []).find((action) => action.actionType === 'task.decompose') ?? null;
  const draftAction =
    (decomposeQuery.data ?? []).find((action) => action.actionType === 'task.draft') ?? null;

  function refresh(): void {
    void page.refresh();
  }

  const backLink = (
    <Link to={HOME_PATH} className={BACK_LINK_CLASS}>
      {t.thread.back}
    </Link>
  );

  if (detailQuery.isLoading) {
    return (
      <div className="flex h-full min-h-0 bg-canvas">
        <ThreadCanvas>
          {backLink}
          <div className="pt-4">
            <TaskSkeleton />
          </div>
        </ThreadCanvas>
      </div>
    );
  }

  if (detailQuery.error !== null || detail === null) {
    const missing = detailQuery.error instanceof ApiError && detailQuery.error.status === 404;
    return (
      <div className="flex h-full min-h-0 bg-canvas">
        <ThreadCanvas>
          {backLink}
          <div className="py-16 text-center">
            <h2 className="font-display text-[length:var(--text-section)] font-semibold">
              {missing ? t.thread.notFoundTitle : t.thread.loadFailedTitle}
            </h2>
            <p className="mt-3 text-[length:var(--text-meta)] text-muted">
              {missing ? t.thread.notFoundHint : t.thread.loadFailedHint}
            </p>
            {missing ? (
              <Link
                to={HOME_PATH}
                className="mt-5 inline-flex h-9 items-center rounded-md bg-accent-deep px-3.5 text-[length:var(--text-meta)] font-medium text-on-accent"
              >
                {t.thread.backToday}
              </Link>
            ) : (
              <Button className="mt-5" onClick={() => void detailQuery.refetch()}>
                {t.today.retry}
              </Button>
            )}
          </div>
        </ThreadCanvas>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <ThreadCanvas>
        {backLink}
        <ThreadHeader detail={detail} timeZone={timeZone} now={now} />
        <ThreadNextStep
          detail={detail}
          timeZone={timeZone}
          onNewTask={() => page.startCreate()}
        />
        <ThreadHabits habits={detail.habits} />
        <ThreadTasks
          detail={detail}
          timeZone={timeZone}
          creating={creatingTask}
          onCreatingChange={(value) => page.setCreating(value)}
          onRefresh={refresh}
        />
        <ThreadMaterials detail={detail} onRefresh={refresh} />
        <ThreadAgentLog detail={detail} timeZone={timeZone} />
      </ThreadCanvas>

      {detailOpen && detailTask ? (
        <div data-region="detail-slot" className={DETAIL_COL}>
          <TaskDetail
            key={detailTask.id}
            task={detailTask}
            subtasks={tasks.filter((task) => task.parentId === detailTask.id)}
            lists={listsQuery.data ?? []}
            tags={tagsQuery.data ?? []}
            outcomes={[detail.outcome]}
            decomposeAction={decomposeAction}
            draftAction={draftAction}
            timeZone={timeZone}
            onPatch={(input) =>
              todoActions.patch.mutateAsync({ id: detailTask.id, input }).then(refresh)
            }
            onComplete={(task: Task) => {
              void todoActions.complete(task).finally(refresh);
            }}
            onDelete={() => todoActions.remove.mutate(detailTask.id, { onSettled: refresh })}
            onAddSubtask={(name) => {
              void todoActions.create
                .mutateAsync({
                  title: name,
                  listId: detailTask.listId,
                  parentId: detailTask.id,
                  outcomeId: detail.outcome.id,
                })
                .then(refresh);
            }}
            onCreateTag={async (name) => todoActions.createTag.mutateAsync(name)}
          />
        </div>
      ) : null}

      <UndoToast onUndo={() => void todoActions.undoComplete().then(refresh)} />
    </div>
  );
}

export const ThreadWorkspace: FC = bindServices(ThreadWorkspaceContent, [ThreadPageService]);
