import type { List, PatchTaskInput, Tag, Task, TaskPriority, TimeBucket } from '@vital/dto';
import { useState, type FormEvent } from 'react';
import { t } from '@/copy';
import { Button } from '@/ui/button';
import {
  fromDatetimeLocal,
  inboxList,
  recurrenceKind,
  rruleForKind,
  toDateInput,
  toDatetimeLocal,
  userLists,
  zonedLocalMidnightIso,
} from './model';
import { TaskCheckbox } from './TaskRow';
import { todosUi, useTodosUi } from './todos-ui.service';

const fieldClass =
  'h-[var(--field-h)] w-full rounded-md border border-border bg-surface px-3 text-fg';
const labelClass = 'text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted';

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className={labelClass}>
      {children}
    </label>
  );
}

export function TaskDetail({
  task,
  subtasks,
  lists,
  tags,
  timeZone,
  onPatch,
  onComplete,
  onDelete,
  onAddSubtask,
  onCreateTag,
}: {
  task: Task;
  subtasks: Task[];
  lists: List[];
  tags: Tag[];
  timeZone: string;
  onPatch: (input: PatchTaskInput) => void;
  onComplete: (task: Task) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onCreateTag: (name: string) => Promise<Tag | void>;
}) {
  const closeDetail = useTodosUi((s) => s.closeDetail);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [subTitle, setSubTitle] = useState('');
  const [tagDraft, setTagDraft] = useState('');

  const inbox = inboxList(lists);
  const movable = task.parentId === null;
  const allDay = task.isAllDay;
  const zone = task.timezone || timeZone;

  function saveTitle() {
    const next = title.trim();
    if (next !== '' && next !== task.title) onPatch({ title: next });
    else setTitle(task.title);
  }

  function saveNotes() {
    if (notes !== task.notes) onPatch({ notes });
  }

  function setDue(value: string) {
    if (value === '') {
      onPatch({ dueAt: null });
      return;
    }
    const iso = allDay ? zonedLocalMidnightIso(value, zone) : fromDatetimeLocal(value, zone);
    onPatch({ dueAt: iso, isAllDay: allDay });
  }

  function setStart(value: string) {
    if (value === '') {
      onPatch({ startAt: null });
      return;
    }
    const iso = allDay ? zonedLocalMidnightIso(value, zone) : fromDatetimeLocal(value, zone);
    onPatch({ startAt: iso, isAllDay: allDay });
  }

  function toggleTag(id: string) {
    const has = task.tagIds.includes(id);
    const tagIds = has ? task.tagIds.filter((item) => item !== id) : [...task.tagIds, id];
    onPatch({ tagIds });
  }

  async function addTag(event: FormEvent) {
    event.preventDefault();
    const name = tagDraft.trim();
    if (name === '') return;
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!task.tagIds.includes(existing.id)) onPatch({ tagIds: [...task.tagIds, existing.id] });
      setTagDraft('');
      return;
    }
    const created = await onCreateTag(name);
    if (created) onPatch({ tagIds: [...task.tagIds, created.id] });
    setTagDraft('');
  }

  const dueValue =
    task.dueAt === null
      ? ''
      : allDay
        ? toDateInput(task.dueAt, zone)
        : toDatetimeLocal(task.dueAt, zone);
  const startValue =
    task.startAt === null
      ? ''
      : allDay
        ? toDateInput(task.startAt, zone)
        : toDatetimeLocal(task.startAt, zone);
  const kind = recurrenceKind(task.recurrence);

  return (
    <aside
      className="flex h-screen w-detail shrink-0 flex-col overflow-y-auto border-l border-border bg-surface"
      aria-label={task.title}
    >
      <div className="flex items-center justify-between px-4 pt-4">
        <TaskCheckbox task={task} timeZone={zone} onToggle={() => onComplete(task)} />
        <button
          type="button"
          className="min-h-[var(--touch-min)] px-2 text-[length:var(--text-meta)] text-muted hover:text-fg"
          onClick={() => closeDetail()}
          aria-label={t.todos.closeDetail}
        >
          {t.todos.closeDetail}
        </button>
      </div>

      <div className="flex flex-col gap-4 px-4 py-3">
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          rows={2}
          className="resize-none rounded-md border border-border bg-surface px-3 py-2 text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em] text-fg"
          aria-label={t.todos.title}
        />

        <div className="flex gap-1" role="radiogroup" aria-label={t.todos.priority.p0}>
          {([0, 1, 2, 3] as TaskPriority[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={task.priority === p}
              className={`min-h-[var(--touch-min)] flex-1 rounded-md text-[length:var(--text-meta)] ${
                task.priority === p
                  ? 'bg-accent-subtle text-fg'
                  : 'text-muted hover:bg-surface-muted'
              }`}
              onClick={() => onPatch({ priority: p })}
            >
              {t.todos.priority[`p${p}` as 'p0' | 'p1' | 'p2' | 'p3']}
            </button>
          ))}
        </div>

        {task.status !== 'done' ? (
          <div>
            <FieldLabel htmlFor="todo-status">{t.todos.status.todo}</FieldLabel>
            <select
              id="todo-status"
              className={fieldClass}
              value={task.status === 'doing' ? 'doing' : 'todo'}
              onChange={(e) => onPatch({ status: e.target.value === 'doing' ? 'doing' : 'todo' })}
            >
              <option value="todo">{t.todos.status.todo}</option>
              <option value="doing">{t.todos.status.doing}</option>
            </select>
          </div>
        ) : null}

        {movable ? (
          <div>
            <FieldLabel htmlFor="todo-list">{t.todos.list}</FieldLabel>
            <select
              id="todo-list"
              className={fieldClass}
              value={task.listId}
              onChange={(e) => onPatch({ listId: e.target.value })}
            >
              {inbox ? <option value={inbox.id}>{t.lists.inbox}</option> : null}
              {userLists(lists).map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <label className="flex min-h-[var(--touch-min)] items-center gap-2 text-[length:var(--text-meta)]">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => onPatch({ isAllDay: e.target.checked })}
          />
          {t.todos.allDay}
        </label>

        <div>
          <FieldLabel htmlFor="todo-due">{t.todos.due}</FieldLabel>
          <input
            id="todo-due"
            className={fieldClass}
            type={allDay ? 'date' : 'datetime-local'}
            value={dueValue}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor="todo-start">{t.todos.start}</FieldLabel>
          <input
            id="todo-start"
            className={fieldClass}
            type={allDay ? 'date' : 'datetime-local'}
            value={startValue}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>

        {task.dueAt === null && task.startAt === null ? (
          <div>
            <FieldLabel htmlFor="todo-bucket">{t.todos.timeBucket}</FieldLabel>
            <select
              id="todo-bucket"
              className={fieldClass}
              value={task.timeBucket}
              onChange={(e) =>
                onPatch({ timeBucket: e.target.value as TimeBucket, dueAt: null, startAt: null })
              }
            >
              <option value="anytime">{t.lists.anytime}</option>
              <option value="someday">{t.lists.someday}</option>
              <option value="dated">{t.todos.due}</option>
            </select>
          </div>
        ) : null}

        <div>
          <FieldLabel htmlFor="todo-recurrence">{t.todos.recurrence}</FieldLabel>
          <select
            id="todo-recurrence"
            className={fieldClass}
            value={kind === 'custom' ? 'custom' : kind}
            onChange={(e) => {
              const value = e.target.value;
              if (value === 'none') onPatch({ recurrence: null });
              else if (
                value === 'daily' ||
                value === 'weekly' ||
                value === 'monthly' ||
                value === 'yearly'
              ) {
                onPatch({ recurrence: rruleForKind(value) });
              }
            }}
          >
            <option value="none">{t.todos.recurrenceNone}</option>
            <option value="daily">{t.todos.recurrenceDaily}</option>
            <option value="weekly">{t.todos.recurrenceWeekly}</option>
            <option value="monthly">{t.todos.recurrenceMonthly}</option>
            <option value="yearly">{t.todos.recurrenceYearly}</option>
            {kind === 'custom' ? <option value="custom">{task.recurrence}</option> : null}
          </select>
        </div>

        <div>
          <FieldLabel htmlFor="todo-remind">{t.todos.remind}</FieldLabel>
          <input
            id="todo-remind"
            className={fieldClass}
            type="datetime-local"
            value={task.remindAt ? toDatetimeLocal(task.remindAt, zone) : ''}
            onChange={(e) =>
              onPatch({
                remindAt: e.target.value === '' ? null : fromDatetimeLocal(e.target.value, zone),
              })
            }
          />
        </div>

        <div>
          <p className={labelClass}>{t.todos.tags}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.length === 0 ? <p className="text-muted">{t.empty.tags}</p> : null}
            {tags.map((tag) => {
              const on = task.tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={`min-h-[var(--touch-min)] rounded-full px-3 text-[length:var(--text-caption)] ${
                    on ? 'bg-accent-subtle text-fg' : 'bg-surface-muted text-muted'
                  }`}
                  onClick={() => toggleTag(tag.id)}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
          <form onSubmit={(e) => void addTag(e)} className="mt-2">
            <input
              className={fieldClass}
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder={t.todos.addTag}
              aria-label={t.todos.addTag}
              maxLength={40}
            />
          </form>
        </div>

        <div>
          <FieldLabel htmlFor="todo-notes">{t.todos.notes}</FieldLabel>
          <textarea
            id="todo-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            rows={5}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-fg"
          />
        </div>

        {task.parentId === null ? (
          <div>
            <p className={labelClass}>{t.todos.subtasks}</p>
            <ul className="mt-1 flex flex-col">
              {subtasks.map((child) => (
                <li key={child.id} className="flex min-h-[var(--touch-min)] items-center gap-2">
                  <TaskCheckbox task={child} timeZone={zone} onToggle={() => onComplete(child)} />
                  <button
                    type="button"
                    className={`truncate text-left text-[length:var(--text-body)] ${
                      child.status === 'done' ? 'text-muted line-through' : 'text-fg'
                    }`}
                    onClick={() => todosUi().openDetail(child.id)}
                  >
                    {child.title}
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-2"
              onSubmit={(e) => {
                e.preventDefault();
                const next = subTitle.trim();
                if (next === '') return;
                onAddSubtask(next);
                setSubTitle('');
              }}
            >
              <input
                className={fieldClass}
                value={subTitle}
                onChange={(e) => setSubTitle(e.target.value)}
                placeholder={t.todos.addSubtask}
                aria-label={t.todos.addSubtask}
                maxLength={500}
              />
            </form>
          </div>
        ) : null}

        <Button variant="quiet" className="text-danger" onClick={() => onDelete()}>
          {t.todos.deleteTask}
        </Button>
      </div>
    </aside>
  );
}
