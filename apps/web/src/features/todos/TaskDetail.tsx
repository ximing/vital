import type { List, PatchTaskInput, Tag, Task } from '@vital/dto';
import { Ellipsis, Folder, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@/copy';
import { useAuth } from '@/services/auth.service';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { usePopover } from '@/ui/use-popover';
import { NotesEditor } from './NotesEditor';
import { addDaysYmd, inboxList, todayYmd, userLists } from './model';
import { PriorityMenu } from './priority';
import { draftFromTask, draftToPatch, scheduleDayPatch } from './schedule-draft';
import { SchedulePopover } from './SchedulePopover';
import { TaskCheckbox } from './TaskRow';
import { todosUi, useTodosUi } from './todos-ui.service';

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
  const moreRef = useRef<HTMLDivElement>(null);
  const moreMenu = usePopover(moreRef);

  useEffect(() => {
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
    };
  }, []);

  const inbox = inboxList(lists);
  const movable = task.parentId === null;
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

  const schedule = draftFromTask(task, zone);
  const listOptions = [
    ...(inbox ? [{ id: inbox.id, name: t.lists.inbox }] : []),
    ...userLists(lists).map((list) => ({ id: list.id, name: list.name })),
  ];

  return (
    <aside
      data-region="detail"
      className="flex h-full min-h-0 w-full shrink-0 flex-col bg-surface"
      aria-label={task.title}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
        <TaskCheckbox task={task} timeZone={zone} onToggle={() => onComplete(task)} />
        <SchedulePopover
          draft={schedule}
          zone={zone}
          weekStartsOn={weekStartsOn}
          align="end"
          onChange={(next) => onPatch(draftToPatch(next, zone))}
        />
        <div className="ml-auto flex items-center gap-0.5">
          <PriorityMenu value={task.priority} onChange={(priority) => onPatch({ priority })} />
          {movable ? (
            <ListPicker
              value={task.listId}
              options={listOptions}
              onChange={(listId) => onPatch({ listId })}
            />
          ) : null}
          <div ref={moreRef} className="relative">
            <button
              type="button"
              aria-label={t.todos.more}
              aria-expanded={moreMenu.open}
              onClick={() => moreMenu.toggle()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg"
            >
              <Icon icon={Ellipsis} size={15} />
            </button>
            {moreMenu.open ? (
              <div
                role="menu"
                className={`absolute right-0 z-[var(--z-dropdown)] mt-1 w-44 ${FIELD_POPOVER_CLASS} p-1`}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] text-fg hover:bg-surface-muted"
                  onClick={() => {
                    onPatch(scheduleDayPatch(task, todayYmd(zone), zone));
                    moreMenu.close();
                  }}
                >
                  {t.todos.scheduleToday}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] text-fg hover:bg-surface-muted"
                  onClick={() => {
                    onPatch(scheduleDayPatch(task, addDaysYmd(todayYmd(zone), 1), zone));
                    moreMenu.close();
                  }}
                >
                  {t.todos.scheduleTomorrow}
                </button>
                {task.dueAt !== null || task.startAt !== null ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] text-fg hover:bg-surface-muted"
                    onClick={() => {
                      onPatch({ startAt: null, dueAt: null, isAllDay: true });
                      moreMenu.close();
                    }}
                  >
                    {t.todos.clearDate}
                  </button>
                ) : null}
                <div className="mx-1 my-1 h-px bg-border/60" />
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] text-danger hover:bg-surface-muted"
                  onClick={() => {
                    onDelete();
                    moreMenu.close();
                  }}
                >
                  {t.todos.deleteTask}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg"
            onClick={() => closeDetail()}
            aria-label={t.todos.closeDetail}
          >
            <Icon icon={X} size={16} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          rows={1}
          className="w-full resize-none bg-transparent text-[length:var(--text-title)] font-semibold leading-[var(--text-title-lh)] tracking-[-0.03em] text-fg outline-none"
          aria-label={t.todos.title}
        />

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {tags
            .filter((tag) => task.tagIds.includes(tag.id))
            .map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="h-6 rounded-full bg-accent-subtle px-2 text-[length:var(--text-caption)] text-fg"
                onClick={() => toggleTag(tag.id)}
              >
                #{tag.name}
              </button>
            ))}
          <form onSubmit={(e) => void addTag(e)}>
            <input
              className="h-6 w-28 rounded-full bg-transparent px-2 text-[length:var(--text-caption)] text-fg placeholder:text-muted outline-none hover:bg-surface-muted focus:bg-surface-muted"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder={t.todos.addTag}
              aria-label={t.todos.addTag}
              maxLength={40}
            />
          </form>
        </div>

        <div className="mt-6">
          <p className="mb-1.5 text-[length:var(--text-meta)] font-medium leading-[var(--text-meta-lh)] text-muted">
            {t.todos.notes}
          </p>
          <NotesEditor value={notes} onChange={queueNotes} />
        </div>

        {task.parentId === null ? (
          <div className="mt-6 rounded-xl bg-canvas px-3 py-2.5 ring-1 ring-border/50">
            <p className="mb-1 flex items-baseline gap-1.5 text-[length:var(--text-meta)] font-medium leading-[var(--text-meta-lh)] text-fg">
              {t.todos.subtasks}
              {subtasks.length > 0 ? (
                <span className="text-[length:var(--text-caption)] font-normal text-tertiary">
                  {subtasks.filter((child) => child.status === 'done').length}/{subtasks.length}
                </span>
              ) : null}
            </p>
            <ul className="flex flex-col">
              {subtasks.map((child) => (
                <li
                  key={child.id}
                  className="flex min-h-9 items-center gap-2.5 border-b border-border/50 last:border-b-0"
                >
                  <TaskCheckbox task={child} timeZone={zone} onToggle={() => onComplete(child)} />
                  <button
                    type="button"
                    className={`min-w-0 flex-1 truncate py-1.5 text-left text-[length:var(--text-body)] ${
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
              onSubmit={(e) => {
                e.preventDefault();
                const next = subTitle.trim();
                if (next === '') return;
                onAddSubtask(next);
                setSubTitle('');
              }}
            >
              <label className="flex h-9 items-center gap-2 text-accent">
                <Icon icon={Plus} size={15} className="shrink-0" />
                <input
                  className="h-full min-w-0 flex-1 bg-transparent text-[length:var(--text-meta)] text-fg placeholder:text-accent/70 outline-none"
                  value={subTitle}
                  onChange={(e) => setSubTitle(e.target.value)}
                  placeholder={t.todos.addSubtask}
                  aria-label={t.todos.addSubtask}
                  maxLength={500}
                />
              </label>
            </form>
          </div>
        ) : null}

      </div>
    </aside>
  );
}

function ListPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popover = usePopover(popoverRef);
  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        aria-label={t.todos.list}
        aria-expanded={popover.open}
        onClick={() => popover.toggle()}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-fg"
      >
        <Icon icon={Folder} size={15} />
      </button>
      {popover.open ? (
        <div
          role="menu"
          className={`absolute left-0 z-[var(--z-dropdown)] mt-1 max-h-56 w-44 overflow-y-auto ${FIELD_POPOVER_CLASS} p-1`}
        >
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] hover:bg-surface-muted ${
                item.id === value ? 'text-fg' : 'text-muted'
              }`}
              onClick={() => {
                onChange(item.id);
                popover.close();
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
