import type { Tag, Task, TaskPriority } from '@vital/dto';
import type { DragEvent } from 'react';
import { t } from '@/copy';
import { EmptyTasks } from './EmptyTasks';
import { splitByPriority, splitByStatus } from './model';
import { TaskRow } from './TaskRow';
import { useTodosUi } from './todos-ui.service';

const STATUS_COLS = ['todo', 'doing', 'done'] as const;
const PRIORITY_COLS: TaskPriority[] = [0, 1, 2, 3];

export function BoardView({
  listId,
  tasks,
  tags,
  timeZone,
  onComplete,
  onStatus,
  onPriority,
}: {
  listId: string;
  tasks: Task[];
  tags: Tag[];
  timeZone: string;
  onComplete: (task: Task) => void;
  onStatus: (task: Task, status: 'todo' | 'doing') => void;
  onPriority: (task: Task, priority: TaskPriority) => void;
}) {
  const boardMode = useTodosUi((s) => s.boardMode);
  const selectedId = useTodosUi((s) => s.selectedId);
  const setSelected = useTodosUi((s) => s.setSelected);
  const openDetail = useTodosUi((s) => s.openDetail);
  const setBoardMode = useTodosUi((s) => s.setBoardMode);

  if (tasks.length === 0) return <EmptyTasks listId={listId} kind="board" />;

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
        selected={selectedId === task.id}
        timeZone={timeZone}
        tags={tags}
        onSelect={() => setSelected(task.id)}
        onOpen={() => openDetail(task.id)}
        onComplete={() => onComplete(task)}
        onDragStart={(event) => dragStart(event, task)}
        onDragOver={dragOver}
      />
    );
  }

  const byStatus = splitByStatus(tasks);
  const byPriority = splitByPriority(tasks);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex pb-3" role="radiogroup" aria-label={t.todos.views.board}>
        <div className="flex rounded-2xl bg-surface p-0.5 shadow-[inset_0_0_0_1px_var(--border-subtle)]">
          <button
            type="button"
            role="radio"
            aria-checked={boardMode === 'status'}
            className={`h-8 rounded-xl px-3 text-[length:var(--text-meta)] ${
              boardMode === 'status'
                ? 'bg-accent-subtle text-fg'
                : 'text-muted hover:text-fg'
            }`}
            onClick={() => setBoardMode('status')}
          >
            {t.todos.boardByStatus}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={boardMode === 'priority'}
            className={`h-8 rounded-xl px-3 text-[length:var(--text-meta)] ${
              boardMode === 'priority'
                ? 'bg-accent-subtle text-fg'
                : 'text-muted hover:text-fg'
            }`}
            onClick={() => setBoardMode('priority')}
          >
            {t.todos.boardByPriority}
          </button>
        </div>
      </div>

      <div
        className={`grid min-h-0 flex-1 auto-rows-fr gap-4 overflow-x-auto ${
          boardMode === 'status' ? 'grid-cols-3' : 'grid-cols-4'
        }`}
      >
        {boardMode === 'status'
          ? STATUS_COLS.map((status) => (
              <section
                key={status}
                className="min-h-0 min-w-[12rem] overflow-y-auto rounded-2xl bg-surface p-3 shadow-[var(--shadow)]"
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
                  {t.todos.status[status]}
                </h2>
                {byStatus[status].map(card)}
              </section>
            ))
          : PRIORITY_COLS.map((priority) => (
              <section
                key={priority}
                className="min-h-0 min-w-[12rem] overflow-y-auto rounded-2xl bg-surface p-3 shadow-[var(--shadow)]"
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
                  {t.todos.priority[`p${priority}` as 'p0' | 'p1' | 'p2' | 'p3']}
                </h2>
                {byPriority[priority].map(card)}
              </section>
            ))}
      </div>
    </div>
  );
}
