import type { Task, Tag } from '@vital/dto';
import { Check } from 'lucide-react';
import type { DragEvent, MouseEvent } from 'react';
import { t } from '@/copy';
import {
  dueMeta,
  formatHm,
  isDueSoon,
  isOverdue,
  recurrenceMeta,
  reminderMeta,
  taskDayYmd,
  todayYmd,
} from './model';
import { PriorityMark } from './priority';

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
        : 'border-tertiary';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={t.todos.complete}
      className={`mt-0.5 flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-full border-[1.5px] ${ring}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {done ? <Check size={11} strokeWidth={3.2} className="text-on-accent" aria-hidden /> : null}
    </button>
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
  onContextMenu,
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
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const overdue = isOverdue(task, timeZone);
  const soon = isDueSoon(task, timeZone);
  const timedToday =
    !task.isAllDay && !overdue && taskDayYmd(task, timeZone) === todayYmd(timeZone);
  const due =
    timedToday && task.dueAt !== null
      ? formatHm(task.dueAt, timeZone)
      : dueMeta(task, timeZone);
  const reminder = reminderMeta(task, timeZone);
  const repeat = recurrenceMeta(task);
  const namedTags = tags.filter((tag) => task.tagIds.includes(tag.id)).slice(0, 3);
  const extraTags = Math.max(0, task.tagIds.length - namedTags.length);
  const done = task.status === 'done';
  const note = task.notes.replaceAll(/\s+/g, ' ').trim();
  const metaParts: { key: 'project' | 'reminder' | 'recurrence'; text: string }[] = [];
  if (listName) metaParts.push({ key: 'project', text: listName });
  if (reminder) metaParts.push({ key: 'reminder', text: reminder });
  if (repeat) metaParts.push({ key: 'recurrence', text: repeat });

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
      onContextMenu={onContextMenu}
      className={`group flex cursor-pointer items-start gap-2.5 px-3 py-2.5 ${
        selected ? 'rounded-lg bg-surface-muted' : 'rounded-lg hover:bg-surface'
      } ${depth === 1 ? 'ml-7' : ''}`}
    >
      <TaskCheckbox task={task} timeZone={timeZone} onToggle={onComplete} />
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[length:var(--text-body)] font-medium leading-[var(--text-body-lh)] ${
            done ? 'text-muted line-through' : 'text-fg'
          }`}
        >
          <PriorityMark priority={task.priority} className="mr-1.5 align-middle" />
          {task.title}
        </p>
        {note !== '' ? (
          <p
            className={`mt-0.5 truncate text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] ${
              done ? 'text-muted/70' : 'text-tertiary'
            }`}
          >
            {note}
          </p>
        ) : null}
        {namedTags.length > 0 ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-1">
            {namedTags.map((tag) => (
              <span
                key={tag.id}
                data-task-meta="tag"
                className="inline-flex h-5 items-center rounded-full bg-accent-subtle px-2 text-[length:var(--text-caption)] font-medium text-accent"
              >
                {tag.name}
              </span>
            ))}
            {extraTags > 0 ? <span className="text-tertiary">+{extraTags}</span> : null}
          </p>
        ) : null}
      </div>
      {metaParts.length > 0 || due ? (
        <p className="mt-0.5 flex max-w-[46%] shrink-0 flex-col items-end gap-px text-right font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] tabular-nums">
          {metaParts.length > 0 ? (
            <span className="max-w-full truncate text-tertiary">
              {metaParts.map((part, index) => (
                <span key={part.key}>
                  {index > 0 ? <span aria-hidden> · </span> : null}
                  <span data-task-meta={part.key}>{part.text}</span>
                </span>
              ))}
            </span>
          ) : null}
          {due ? (
            <span
              data-task-meta="due"
              className={`shrink-0 ${
                overdue
                  ? 'text-overdue'
                  : timedToday
                    ? 'text-doing'
                    : soon
                      ? 'text-due'
                      : 'text-tertiary'
              }`}
            >
              {due}
            </span>
          ) : null}
        </p>
      ) : null}
      <button
        type="button"
        className="sr-only"
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
