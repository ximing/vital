import type { List, Tag, Task, TaskPriority } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { type DragEvent, type FC } from 'react';
import { t } from '@/copy';
import { listTitle, splitByPriority, splitByStatus } from './model';
import { QuickAdd, type ComposeExtras } from './QuickAdd';
import type { ScheduleDraft } from './schedule-draft';
import { TaskRow } from './TaskRow';
import { TodosUiService } from './todos-ui.service';

const STATUS_COLS = ['todo', 'doing', 'done'] as const;
const PRIORITY_COLS: TaskPriority[] = [0, 1, 2, 3];

export const BoardView: FC<{
  listId: string;
  tasks: Task[];
  tags: Tag[];
  lists: List[];
  timeZone: string;
  weekStartsOn: 0 | 1;
  defaultListId: string;
  listName: string;
  disabled?: boolean;
  onComplete: (task: Task) => void;
  onStatus: (task: Task, status: 'todo' | 'doing') => void;
  onPriority: (task: Task, priority: TaskPriority) => void;
  onCreate: (title: string, draft: ScheduleDraft, extras: ComposeExtras) => void;
  intent?: boolean;
  onTaskMenu?: (task: Task, x: number, y: number) => void;
}> = observer(function BoardView({
  listId,
  tasks,
  tags,
  lists,
  timeZone,
  weekStartsOn,
  defaultListId,
  listName,
  disabled,
  onComplete,
  onStatus,
  onPriority,
  onCreate,
  intent = false,
  onTaskMenu,
}: {
  listId: string;
  tasks: Task[];
  tags: Tag[];
  lists: List[];
  timeZone: string;
  weekStartsOn: 0 | 1;
  defaultListId: string;
  listName: string;
  disabled?: boolean;
  onComplete: (task: Task) => void;
  onStatus: (task: Task, status: 'todo' | 'doing') => void;
  onPriority: (task: Task, priority: TaskPriority) => void;
  onCreate: (title: string, draft: ScheduleDraft, extras: ComposeExtras) => void;
  intent?: boolean;
  onTaskMenu?: (task: Task, x: number, y: number) => void;
}) {
  const todos = useService(TodosUiService);

  function dragStart(event: DragEvent<HTMLDivElement>, task: Task) {
    event.dataTransfer.setData('text/plain', task.id);
    event.dataTransfer.effectAllowed = 'move';
  }

  function dragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function card(task: Task) {
    return (
      <TaskRow
        key={task.id}
        task={task}
        depth={0}
        selected={todos.selectedId === task.id}
        timeZone={timeZone}
        tags={tags}
        listName={listId.startsWith('smart:') ? listTitle(task.listId, lists, '') : undefined}
        onSelect={() => todos.openDetail(task.id)}
        onOpen={() => todos.openDetail(task.id)}
        onComplete={() => onComplete(task)}
        onDragStart={(event) => dragStart(event, task)}
        onDragOver={dragOver}
        onContextMenu={
          onTaskMenu
            ? (event) => {
                event.preventDefault();
                onTaskMenu(task, event.clientX, event.clientY);
              }
            : undefined
        }
      />
    );
  }

  const byStatus = splitByStatus(tasks);
  const byPriority = splitByPriority(tasks);
  const statusCols = todos.hideCompleted ? (['todo', 'doing'] as const) : STATUS_COLS;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`grid min-h-0 flex-1 auto-rows-fr gap-4 overflow-x-auto ${
          todos.boardMode === 'status'
            ? statusCols.length === 2
              ? 'grid-cols-2'
              : 'grid-cols-3'
            : 'grid-cols-4'
        }`}
      >
        {todos.boardMode === 'status'
          ? statusCols.map((status, index) => (
              <section
                key={status}
                className="flex min-h-0 min-w-[14rem] flex-col overflow-visible rounded-2xl bg-surface p-3 shadow-[var(--shadow)]"
                onDragOver={dragOver}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData('text/plain');
                  const task = tasks.find((item) => item.id === id);
                  if (!task) return;
                  if (status === 'done') onComplete(task);
                  else onStatus(task, status);
                }}
              >
                <h2 className="px-2 pb-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
                  {t.todos.status[status]}{' '}
                  <span className="text-tertiary">{byStatus[status].length}</span>
                </h2>
                {status !== 'done' ? (
                  <QuickAdd
                    variant="card"
                    captureId={index === 0}
                    onSubmit={onCreate}
                    disabled={disabled}
                    listName={listName}
                    lists={lists}
                    defaultListId={defaultListId}
                    zone={timeZone}
                    weekStartsOn={weekStartsOn}
                    lockedStatus={status}
                    intent={intent}
                  />
                ) : null}
                <div className="min-h-0 flex-1 overflow-y-auto">{byStatus[status].map(card)}</div>
              </section>
            ))
          : PRIORITY_COLS.map((priority, index) => (
              <section
                key={priority}
                className="flex min-h-0 min-w-[14rem] flex-col overflow-visible rounded-2xl bg-surface p-3 shadow-[var(--shadow)]"
                onDragOver={dragOver}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = event.dataTransfer.getData('text/plain');
                  const task = tasks.find((item) => item.id === id);
                  if (!task) return;
                  onPriority(task, priority);
                }}
              >
                <h2 className="px-2 pb-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
                  {t.todos.priority[`p${priority}` as 'p0' | 'p1' | 'p2' | 'p3']}{' '}
                  <span className="text-tertiary">{byPriority[priority].length}</span>
                </h2>
                <QuickAdd
                  variant="card"
                  captureId={index === 0}
                  onSubmit={onCreate}
                  disabled={disabled}
                  listName={listName}
                  lists={lists}
                  defaultListId={defaultListId}
                  zone={timeZone}
                  weekStartsOn={weekStartsOn}
                  lockedPriority={priority}
                  intent={intent}
                />
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {byPriority[priority].map(card)}
                </div>
              </section>
            ))}
      </div>
    </div>
  );
});
