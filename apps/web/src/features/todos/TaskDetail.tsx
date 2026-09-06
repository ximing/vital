import type { List, PatchTaskInput, Tag, Task, TimeBucket } from '@vital/dto';
import { Bell, Calendar, Folder, ListTodo, Repeat, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { t } from '@/copy';
import { useAuth } from '@/services/auth.service';
import { Button } from '@/ui/button';
import { DateField } from '@/ui/date-field';
import { Icon, type LucideIcon } from '@/ui/icon';
import { NotesEditor } from './NotesEditor';
import { PriorityPicker } from './priority';
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

const controlClass =
  'h-9 w-full rounded-xl border border-transparent bg-transparent px-2 text-[length:var(--text-meta)] text-fg hover:border-border focus:border-border';

function PropRow({
  icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1.25rem_3.5rem_minmax(0,1fr)] items-center gap-x-2">
      <Icon icon={icon} size={15} className="justify-self-center text-muted" />
      <span className="truncate text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
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
  const weekStartsOn = useAuth((s) => (s.user?.weekStartsOn === 0 ? 0 : 1));
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [subTitle, setSubTitle] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
    };
  }, []);

  const inbox = inboxList(lists);
  const movable = task.parentId === null;
  const allDay = task.isAllDay;
  const zone = task.timezone || timeZone;

  function saveTitle() {
    const next = title.trim();
    if (next !== '' && next !== task.title) onPatch({ title: next });
    else setTitle(task.title);
  }

  function queueNotes(next: string) {
    setNotes(next);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      if (next !== task.notes) onPatch({ notes: next });
    }, 600);
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
      data-region="detail"
      className="flex h-full min-h-full w-full max-w-[25rem] shrink-0 flex-col bg-elevated"
      aria-label={task.title}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <TaskCheckbox task={task} timeZone={zone} onToggle={() => onComplete(task)} />
        <button
          type="button"
          className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
          onClick={() => closeDetail()}
          aria-label={t.todos.closeDetail}
        >
          <Icon icon={X} size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          rows={2}
          className="w-full resize-none bg-transparent text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em] text-fg outline-none"
          aria-label={t.todos.title}
        />

        <div className="mt-4 flex flex-col gap-1.5">
          <PriorityPicker value={task.priority} onChange={(priority) => onPatch({ priority })} />

          {movable ? (
            <PropRow icon={Folder} label={t.todos.list}>
              <select
                className={controlClass}
                value={task.listId}
                aria-label={t.todos.list}
                onChange={(e) => onPatch({ listId: e.target.value })}
              >
                {inbox ? <option value={inbox.id}>{t.lists.inbox}</option> : null}
                {userLists(lists).map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </PropRow>
          ) : null}

          {task.status !== 'done' ? (
            <PropRow icon={ListTodo} label={t.todos.status.todo}>
              <select
                className={controlClass}
                value={task.status === 'doing' ? 'doing' : 'todo'}
                aria-label={t.todos.status.todo}
                onChange={(e) => onPatch({ status: e.target.value === 'doing' ? 'doing' : 'todo' })}
              >
                <option value="todo">{t.todos.status.todo}</option>
                <option value="doing">{t.todos.status.doing}</option>
              </select>
            </PropRow>
          ) : null}

          <PropRow icon={Sun} label={t.todos.allDay}>
            <label className="flex h-9 items-center gap-2 text-[length:var(--text-meta)]">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => onPatch({ isAllDay: e.target.checked })}
              />
              {t.todos.allDay}
            </label>
          </PropRow>

          <PropRow icon={Calendar} label={t.todos.due}>
            <DateField
              value={dueValue}
              kind={allDay ? 'date' : 'datetime-local'}
              ariaLabel={t.todos.due}
              zone={zone}
              weekStartsOn={weekStartsOn}
              onChange={setDue}
            />
          </PropRow>
          <PropRow icon={Calendar} label={t.todos.start}>
            <DateField
              value={startValue}
              kind={allDay ? 'date' : 'datetime-local'}
              ariaLabel={t.todos.start}
              zone={zone}
              weekStartsOn={weekStartsOn}
              onChange={setStart}
            />
          </PropRow>

          {task.dueAt === null && task.startAt === null ? (
            <PropRow icon={Folder} label={t.todos.timeBucket}>
              <select
                className={controlClass}
                value={task.timeBucket}
                aria-label={t.todos.timeBucket}
                onChange={(e) =>
                  onPatch({ timeBucket: e.target.value as TimeBucket, dueAt: null, startAt: null })
                }
              >
                <option value="anytime">{t.lists.anytime}</option>
                <option value="someday">{t.lists.someday}</option>
                <option value="dated">{t.todos.due}</option>
              </select>
            </PropRow>
          ) : null}

          <PropRow icon={Repeat} label={t.todos.recurrence}>
            <select
              className={controlClass}
              value={kind === 'custom' ? 'custom' : kind}
              aria-label={t.todos.recurrence}
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
          </PropRow>

          <PropRow icon={Bell} label={t.todos.remind}>
            <DateField
              value={task.remindAt ? toDatetimeLocal(task.remindAt, zone) : ''}
              kind="datetime-local"
              ariaLabel={t.todos.remind}
              zone={zone}
              weekStartsOn={weekStartsOn}
              onChange={(value) =>
                onPatch({
                  remindAt: value === '' ? null : fromDatetimeLocal(value, zone),
                })
              }
            />
          </PropRow>
        </div>

        <div className="mt-5">
          <p className="mb-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.todos.tags}
          </p>
          <div className="flex flex-wrap gap-1">
            {tags.length === 0 ? (
              <p className="text-[length:var(--text-caption)] text-muted">{t.empty.tags}</p>
            ) : null}
            {tags.map((tag) => {
              const on = task.tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={`h-7 rounded-full px-2.5 text-[length:var(--text-caption)] ${
                    on ? 'bg-accent-subtle text-fg' : 'bg-surface-muted text-muted hover:text-fg'
                  }`}
                  onClick={() => toggleTag(tag.id)}
                >
                  #{tag.name}
                </button>
              );
            })}
          </div>
          <form onSubmit={(e) => void addTag(e)} className="mt-2">
            <input
              className="h-8 w-full rounded-xl border border-border bg-canvas px-2.5 text-[length:var(--text-meta)] text-fg placeholder:text-muted"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder={t.todos.addTag}
              aria-label={t.todos.addTag}
              maxLength={40}
            />
          </form>
        </div>

        <div className="mt-5">
          <NotesEditor value={notes} onChange={queueNotes} />
        </div>

        {task.parentId === null ? (
          <div className="mt-5">
            <p className="mb-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
              {t.todos.subtasks}
            </p>
            <ul className="flex flex-col">
              {subtasks.map((child) => (
                <li key={child.id} className="flex min-h-9 items-center gap-2">
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
                className="h-8 w-full rounded-xl border border-border bg-canvas px-2.5 text-[length:var(--text-meta)] text-fg placeholder:text-muted"
                value={subTitle}
                onChange={(e) => setSubTitle(e.target.value)}
                placeholder={t.todos.addSubtask}
                aria-label={t.todos.addSubtask}
                maxLength={500}
              />
            </form>
          </div>
        ) : null}

        <Button variant="quiet" className="mt-6 text-danger" onClick={() => onDelete()}>
          {t.todos.deleteTask}
        </Button>
      </div>
    </aside>
  );
}
