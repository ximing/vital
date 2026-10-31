import type { Task } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import type { FC } from 'react';
import { t } from '@/copy';
import { useOutcomesQuery, usePendingDecomposeQuery } from '@/features/today';
import {
  TaskDetail,
  TodosUiService,
  UndoToast,
  useListsQuery,
  useTagsQuery,
  useTaskQuery,
  useTasksQuery,
  useTodoActions,
} from '@/features/todos';
import { Overlay } from '@/ui/overlay';

export const ScheduleDetail: FC<{ taskId: string; timeZone: string }> = observer(
  function ScheduleDetail({ taskId, timeZone }) {
    const todos = useService(TodosUiService);
    const query = useTaskQuery(taskId);
    const task = query.data;
    const lists = useListsQuery().data ?? [];
    const tags = useTagsQuery().data ?? [];
    const outcomes = useOutcomesQuery().data ?? [];
    const actions = useTodoActions();
    const persisted = useTasksQuery(task?.listId ?? '', task !== undefined);
    const subtasks = (persisted.data ?? []).filter(
      (item) => task !== undefined && item.parentId === task.id,
    );
    const decomposeQuery = usePendingDecomposeQuery(
      task !== undefined && task.parentId === null ? task.id : null,
    );
    const decomposeAction =
      (decomposeQuery.data ?? []).find((action) => action.actionType === 'task.decompose') ?? null;
    const draftAction =
      (decomposeQuery.data ?? []).find((action) => action.actionType === 'task.draft') ?? null;

    return (
      <>
        <Overlay
          tone="dim"
          align="end"
          onClose={() => todos.closeDetail()}
          closeOnBackdrop
          closeOnEscape
        >
          <div
            data-region="schedule-detail"
            className="h-full w-full max-w-[40rem] bg-surface shadow-[var(--shadow)]"
            onClick={(event) => event.stopPropagation()}
          >
            {task ? (
              <TaskDetail
                key={task.id}
                task={task}
                subtasks={subtasks}
                lists={lists}
                tags={tags}
                outcomes={outcomes}
                decomposeAction={decomposeAction}
                draftAction={draftAction}
                timeZone={timeZone}
                onPatch={(input) => actions.patch.mutateAsync({ id: task.id, input })}
                onComplete={(item: Task) => void actions.complete(item)}
                onDelete={() => actions.remove.mutate(task.id)}
                onAddSubtask={(name) => {
                  void actions.create.mutateAsync({
                    title: name,
                    listId: task.listId,
                    parentId: task.id,
                  });
                }}
                onCreateTag={async (name) => actions.createTag.mutateAsync(name)}
              />
            ) : query.isError ? (
              <div className="flex items-center gap-3 px-4 py-6 text-[length:var(--text-meta)] text-muted">
                <span>{t.schedule.detailError}</span>
                <button
                  type="button"
                  className="text-fg underline-offset-2 hover:underline"
                  onClick={() => void query.refetch()}
                >
                  {t.schedule.retry}
                </button>
              </div>
            ) : (
              <div
                className="skeleton-pulse m-4 min-h-40 rounded-md"
                aria-busy="true"
                aria-label={t.todos.loading}
              />
            )}
          </div>
        </Overlay>
        <UndoToast onUndo={() => void actions.undoComplete()} />
      </>
    );
  },
);
