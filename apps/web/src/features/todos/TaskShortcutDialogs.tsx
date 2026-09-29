import type { Task } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FC } from 'react';
import { t } from '@/copy';
import { todayKeys } from '@/features/today/query-keys';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Overlay } from '@/ui/overlay';
import { inboxList, listPickerRows } from './model';
import { useDetailTask, useListsQuery, useTodoActions } from './queries';
import { TodosUiService } from './todos-ui.service';

export const TaskShortcutDialogs: FC = observer(function TaskShortcutDialogs() {
  const todos = useService(TodosUiService);
  const actions = useTodoActions();
  const queryClient = useQueryClient();
  const lists = useListsQuery().data ?? [];
  const moveTask = useDetailTask(todos.moveTaskId, []);
  const deleteTask = useDetailTask(todos.pendingDeleteId, []);

  async function refreshToday(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: todayKeys.all });
  }

  return (
    <>
      {moveTask && moveTask.parentId === null ? (
        <MoveDialog
          task={moveTask}
          lists={lists}
          onClose={() => todos.closeMove()}
          onPick={(listId) => {
            todos.closeMove();
            void actions.patch
              .mutateAsync({ id: moveTask.id, input: { listId } })
              .then(() => refreshToday());
          }}
        />
      ) : null}
      {deleteTask ? (
        <ConfirmDialog
          title={t.todos.deleteTask}
          body={t.todos.deleteTaskConfirm.replace('{title}', deleteTask.title)}
          confirmLabel={t.todos.deleteTask}
          cancelLabel={t.dialog.cancel}
          danger
          onCancel={() => todos.clearDelete()}
          onConfirm={() => {
            const id = deleteTask.id;
            todos.clearDelete();
            actions.remove.mutate(id, { onSuccess: () => void refreshToday() });
          }}
        />
      ) : null}
    </>
  );
});

function MoveDialog({
  task,
  lists,
  onClose,
  onPick,
}: {
  task: Task;
  lists: Parameters<typeof listPickerRows>[0];
  onClose: () => void;
  onPick: (listId: string) => void;
}) {
  const inbox = inboxList(lists);
  const options = [
    ...(inbox ? [{ id: inbox.id, name: t.lists.inbox, depth: 0 }] : []),
    ...listPickerRows(lists),
  ];
  const [active, setActive] = useState(() => {
    const index = options.findIndex((option) => option.id === task.listId);
    return index >= 0 ? index : 0;
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (options.length === 0) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        setActive((index) => {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          return (index + delta + options.length) % options.length;
        });
        return;
      }
      if (event.key === 'Enter') {
        const option = options[active];
        if (!option) return;
        event.preventDefault();
        event.stopPropagation();
        onPick(option.id);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, onPick, options]);

  return (
    <Overlay
      tone="scrim"
      align="center"
      className="px-4"
      onClose={onClose}
      closeOnEscape
      closeOnBackdrop
      lockFocus
      restoreFocus
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.todos.moveTo}
        className="w-full max-w-sm overflow-hidden rounded-xl border border-border bg-elevated p-2 shadow-[var(--shadow)]"
      >
        <p className="px-2 py-1.5 text-[length:var(--text-caption)] text-tertiary">{t.todos.moveTo}</p>
        <div role="listbox" aria-label={t.todos.moveTo} className="max-h-72 overflow-y-auto">
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={index === active}
              className={`flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] ${
                index === active ? 'bg-accent-subtle text-fg' : 'text-muted hover:bg-surface-muted'
              } ${option.depth > 0 ? 'pl-5' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => onPick(option.id)}
            >
              {option.name}
            </button>
          ))}
        </div>
      </div>
    </Overlay>
  );
}
