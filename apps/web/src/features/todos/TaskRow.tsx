import type { Task, Tag } from '@vital/dto';
import type { DragEvent } from 'react';
import { t } from '@/copy';
import { dueMeta, isDueSoon, isOverdue } from './model';
import { priorityBarClass, PriorityMark } from './priority';

export function TaskCheckbox({
  task,
  timeZone,
  onToggle,
}: {
  task: Task;
  timeZone: string;
  onToggle: () => void;
}) {
  const overdue = isOverdue(task, timeZone);
  const soon = isDueSoon(task, timeZone);
  const done = task.status === 'done';
  const ring = done
    ? 'border-done bg-done'
    : overdue
      ? 'border-overdue'
      : soon
        ? 'border-due'
        : 'border-border';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={t.todos.complete}
      className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border ${ring}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    />
  );
}

export function TaskRow({
  task,
  depth,
  selected,
  timeZone,
  tags,
  onSelect,
  onOpen,
  onComplete,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  task: Task;
  depth: 0 | 1;
  selected: boolean;
  timeZone: string;
  tags: Tag[];
  onSelect: () => void;
  onOpen: () => void;
  onComplete: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const overdue = isOverdue(task, timeZone);
  const soon = isDueSoon(task, timeZone);
  const meta = dueMeta(task, timeZone);
  const namedTags = tags.filter((tag) => task.tagIds.includes(tag.id));
  const done = task.status === 'done';

  return (
    <div
      role="option"
      aria-label={task.title}
      aria-selected={selected}
      data-task-id={task.id}
      draggable={onDragStart !== undefined}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`flex min-h-[var(--touch-min)] cursor-pointer items-start gap-3 rounded-xl px-3 py-2 transition-[background-color] duration-[var(--ease-out)] ${
        selected ? 'bg-accent-subtle' : 'hover:bg-surface-muted'
      } ${depth === 1 ? 'ml-8' : ''}`}
    >
      {task.priority < 3 ? (
        <span
          className={`mt-2 h-5 w-[3px] shrink-0 rounded-full ${priorityBarClass(task.priority)}`}
        />
      ) : (
        <span className="mt-2 w-[3px] shrink-0" />
      )}
      <TaskCheckbox task={task} timeZone={timeZone} onToggle={onComplete} />
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[length:var(--text-body)] leading-[var(--text-body-lh)] ${
            done ? 'text-muted line-through' : 'text-fg'
          }`}
        >
          <PriorityMark priority={task.priority} className="mr-1.5 align-middle" />
          {task.title}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)]">
          {meta ? (
            <span className={overdue ? 'text-overdue' : soon ? 'text-due' : 'text-muted'}>
              {meta}
            </span>
          ) : null}
          {namedTags.map((tag) => (
            <span key={tag.id} className="rounded-full bg-surface-muted px-2 text-muted">
              {tag.name}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
