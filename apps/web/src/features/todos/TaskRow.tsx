import type { Task, Tag } from '@vital/dto';
import type { DragEvent } from 'react';
import { t } from '@/copy';
import { dueMeta, isDueSoon, isOverdue, recurrenceMeta, reminderMeta } from './model';
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
  listName,
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
  listName?: string;
  onSelect: () => void;
  onOpen: () => void;
  onComplete: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const overdue = isOverdue(task, timeZone);
  const soon = isDueSoon(task, timeZone);
  const due = dueMeta(task, timeZone);
  const reminder = reminderMeta(task, timeZone);
  const repeat = recurrenceMeta(task);
  const namedTags = tags.filter((tag) => task.tagIds.includes(tag.id)).slice(0, 3);
  const extraTags = Math.max(0, task.tagIds.length - namedTags.length);
  const done = task.status === 'done';
  const note = task.notes.replaceAll(/\s+/g, ' ').trim();

  return (
    <div
      role="option"
      aria-label={task.title}
      aria-selected={selected}
      data-task-id={task.id}
      data-density="task-row"
      draggable={onDragStart !== undefined}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`group flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-3 py-2 transition-[background-color] duration-[var(--ease-out)] ${
        selected ? 'bg-surface-muted' : 'hover:bg-surface-muted'
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
        {note !== '' ? (
          <p className={`mt-0.5 truncate text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] ${done ? 'text-muted/70' : 'text-muted'}`}>
            {note}
          </p>
        ) : null}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)]">
          {due ? (
            <span
              data-task-meta="due"
              className={overdue ? 'text-overdue' : soon ? 'text-due' : 'text-secondary'}
            >
              {due}
            </span>
          ) : null}
          {reminder ? (
            <span data-task-meta="reminder" className="text-muted">
              {reminder}
            </span>
          ) : null}
          {repeat ? (
            <span data-task-meta="recurrence" className="text-muted">
              {repeat}
            </span>
          ) : null}
          {listName ? (
            <span data-task-meta="project" className="text-tertiary">
              {listName}
            </span>
          ) : null}
          {namedTags.map((tag) => (
            <span
              key={tag.id}
              data-task-meta="tag"
              className="text-tertiary"
            >
              #{tag.name}
            </span>
          ))}
          {extraTags > 0 ? <span className="text-tertiary">+{extraTags}</span> : null}
        </p>
      </div>
      <button
        type="button"
        className="mt-0.5 h-8 shrink-0 rounded-md px-2 text-[length:var(--text-caption)] text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-surface hover:text-fg"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        {t.todos.openDetail}
      </button>
    </div>
  );
}
