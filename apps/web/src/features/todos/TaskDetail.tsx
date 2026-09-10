import type { AgentAction, List, Outcome, PatchTaskInput, Tag, Task } from '@vital/dto';
import { Ellipsis, Folder, Pin, Plus, Timer, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@/copy';
import { useAuth } from '@/services/auth.service';
import { FIELD_CONTROL_OPEN_CLASS, FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { META_CHIP_CLASS, OutcomeField } from '@/ui/outcome-field';
import { usePopover } from '@/ui/use-popover';
import { DecomposeBanner } from '@/features/today/DecomposeBanner';
import { DraftSection } from './DraftSection';
import { NotesEditor } from './NotesEditor';
import { addDaysYmd, inboxList, listPickerRows, todayYmd } from './model';
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
  outcomes = [],
  decomposeAction = null,
  draftAction = null,
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
  /** Open threads for the outcome selector. */
  outcomes?: Outcome[];
  /** Pending task.decompose proposal for this task, if any. */
  decomposeAction?: AgentAction | null;
  /** Pending task.draft proposal for this task, if any. */
  draftAction?: AgentAction | null;
  timeZone: string;
  /** May return a promise; save-status indicator tracks its settlement. */
  onPatch: (input: PatchTaskInput) => Promise<unknown> | void;
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

  type SaveState = 'idle' | 'editing' | 'saving' | 'saved' | 'error';
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const pendingSaves = useRef(0);
  const failedSaves = useRef(0);
  const lastFailedPatch = useRef<PatchTaskInput | null>(null);

  function runPatch(input: PatchTaskInput) {
    pendingSaves.current += 1;
    setSaveState('saving');
    Promise.resolve(onPatch(input))
      .then(() => {
        pendingSaves.current -= 1;
        if (pendingSaves.current === 0 && failedSaves.current === 0) {
          setSavedAt(new Date());
          setSaveState('saved');
        }
      })
      .catch(() => {
        pendingSaves.current -= 1;
        failedSaves.current += 1;
        lastFailedPatch.current = input;
        setSaveState('error');
      });
  }

  function retrySave() {
    const failed = lastFailedPatch.current;
    failedSaves.current = 0;
    lastFailedPatch.current = null;
    if (!failed) {
      setSaveState('idle');
      return;
    }
    // Notes may have been edited further after the failure — retry with current text.
    runPatch(failed.notes !== undefined ? { ...failed, notes } : failed);
  }

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
    if (next !== '' && next !== task.title) runPatch({ title: next });
    else setTitle(task.title);
  }

  function queueNotes(next: string) {
    setNotes(next);
    if (next !== task.notes) setSaveState('editing');
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      if (next !== task.notes) runPatch({ notes: next });
    }, 600);
  }

  function toggleTag(id: string) {
    const has = task.tagIds.includes(id);
    const tagIds = has ? task.tagIds.filter((item) => item !== id) : [...task.tagIds, id];
    runPatch({ tagIds });
  }

  async function addTag(event: FormEvent) {
    event.preventDefault();
    const name = tagDraft.trim();
    if (name === '') return;
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!task.tagIds.includes(existing.id)) runPatch({ tagIds: [...task.tagIds, existing.id] });
      setTagDraft('');
      return;
    }
    const created = await onCreateTag(name);
    if (created) runPatch({ tagIds: [...task.tagIds, created.id] });
    setTagDraft('');
  }

  const schedule = draftFromTask(task, zone);
  const listOptions = [
    ...(inbox ? [{ id: inbox.id, name: t.lists.inbox, depth: 0 }] : []),
    ...listPickerRows(lists),
  ];

  return (
    <aside
      data-region="detail"
      className="flex h-full min-h-0 w-full shrink-0 flex-col border-l border-border bg-surface"
      aria-label={task.title}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <TaskCheckbox task={task} timeZone={zone} onToggle={() => onComplete(task)} />
        <SchedulePopover
          draft={schedule}
          zone={zone}
          weekStartsOn={weekStartsOn}
          align="end"
          onChange={(next) => runPatch(draftToPatch(next, zone))}
        />
        <div className="ml-auto flex items-center gap-1">
          <SaveStatus state={saveState} savedAt={savedAt} onRetry={retrySave} />
          {movable ? (
            <button
              type="button"
              aria-label={task.pinned ? t.todos.unpin : t.todos.pin}
              aria-pressed={task.pinned}
              onClick={() => runPatch({ pinned: !task.pinned })}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted ${
                task.pinned ? 'text-accent' : 'text-muted hover:text-fg'
              }`}
            >
              <Icon icon={Pin} size={15} fill={task.pinned ? 'currentColor' : 'none'} />
            </button>
          ) : null}
          <PriorityMenu value={task.priority} onChange={(priority) => runPatch({ priority })} />
          {movable ? (
            <ListPicker
              value={task.listId}
              options={listOptions}
              onChange={(listId) => runPatch({ listId })}
            />
          ) : null}
          <div ref={moreRef} className="relative">
            <button
              type="button"
              aria-label={t.todos.more}
              aria-expanded={moreMenu.open}
              onClick={() => moreMenu.toggle()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
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
                    runPatch(scheduleDayPatch(task, todayYmd(zone), zone));
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
                    runPatch(scheduleDayPatch(task, addDaysYmd(todayYmd(zone), 1), zone));
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
                      runPatch({ startAt: null, dueAt: null, isAllDay: true });
                      moreMenu.close();
                    }}
                  >
                    {t.todos.clearDate}
                  </button>
                ) : null}
                <div className="mx-1 my-1 h-px bg-border" />
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
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
            onClick={() => closeDetail()}
            aria-label={t.todos.closeDetail}
          >
            <Icon icon={X} size={16} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229)
              return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.blur();
          }}
          onBlur={saveTitle}
          rows={1}
          className="font-display w-full resize-none bg-transparent text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] text-fg outline-none"
          aria-label={t.todos.title}
        />

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <OutcomeField
            value={task.outcomeId}
            outcomes={outcomes}
            onChange={(outcomeId) => runPatch({ outcomeId })}
          />
          <EstimateField
            value={task.estimateMinutes}
            onChange={(estimateMinutes) => runPatch({ estimateMinutes })}
          />
          {tags
            .filter((tag) => task.tagIds.includes(tag.id))
            .map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="h-6 rounded-full bg-accent-subtle px-2.5 text-[length:var(--text-caption)] font-medium text-accent transition-opacity duration-[var(--ease-out)] hover:opacity-75"
                onClick={() => toggleTag(tag.id)}
              >
                #{tag.name}
              </button>
            ))}
          <form onSubmit={(e) => void addTag(e)}>
            <input
              className="h-6 w-28 rounded-full border border-dashed border-border bg-transparent px-2.5 text-[length:var(--text-caption)] text-fg outline-none transition-[background-color,border-color] duration-[var(--ease-out)] placeholder:text-muted hover:border-tertiary/50 focus:border-focus focus:bg-surface"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder={t.todos.addTag}
              aria-label={t.todos.addTag}
              maxLength={40}
            />
          </form>
        </div>

        {task.parentId === null && decomposeAction ? (
          <div className="mt-4">
            <DecomposeBanner task={task} action={decomposeAction} />
          </div>
        ) : null}

        <DraftSection
          task={task}
          action={draftAction}
          onToggleDelegable={(delegable) => runPatch({ delegable })}
        />

        <div className="mt-7">
          <p className="eyebrow eyebrow-rule mb-2.5">
            {t.todos.notes}
          </p>
          <NotesEditor value={notes} onChange={queueNotes} />
        </div>

        {task.parentId === null ? (
          <div className="mt-7">
            <p className="eyebrow eyebrow-rule mb-2.5">
              {t.todos.subtasks}
              {subtasks.length > 0 ? (
                <span className="font-mono normal-case tracking-normal tabular-nums opacity-80">
                  {subtasks.filter((child) => child.status === 'done').length}/{subtasks.length}
                </span>
              ) : null}
            </p>
            <div className="rounded-[14px] border border-border bg-canvas px-3 py-1.5">
              <ul className="flex flex-col">
                {subtasks.map((child) => (
                  <li
                    key={child.id}
                    className="flex min-h-10 items-center gap-2.5 border-b border-border/60 last:border-b-0"
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
                <label className="flex h-10 items-center gap-2 text-accent">
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
          </div>
        ) : null}

      </div>
    </aside>
  );
}

const ESTIMATE_PRESETS = [15, 30, 60, 120] as const;

function estimateLabel(minutes: number): string {
  return t.todos.estimateMinutes.replace('{n}', String(minutes));
}

function EstimateField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popover = usePopover(popoverRef);
  const [custom, setCustom] = useState('');

  function applyCustom() {
    const minutes = Number(custom);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 100000) return;
    onChange(minutes);
    setCustom('');
    popover.close();
  }

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        aria-label={t.todos.estimate}
        aria-haspopup="menu"
        aria-expanded={popover.open}
        onClick={() => popover.toggle()}
        className={`${META_CHIP_CLASS} ${value !== null ? 'text-fg' : ''} ${
          popover.open ? FIELD_CONTROL_OPEN_CLASS : ''
        }`}
      >
        <Icon icon={Timer} size={13} className={`shrink-0 ${value !== null ? 'text-accent' : ''}`} />
        <span className="truncate">
          {value !== null ? estimateLabel(value) : t.todos.estimate}
        </span>
      </button>
      {popover.open ? (
        <div
          role="menu"
          aria-label={t.todos.estimate}
          className={`absolute left-0 z-[var(--z-dropdown)] mt-1 w-44 ${FIELD_POPOVER_CLASS} p-1`}
        >
          {ESTIMATE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              role="menuitem"
              className={`flex h-8 w-full items-center rounded-md px-2.5 text-left text-[length:var(--text-meta)] ${
                preset === value ? 'bg-accent-subtle text-fg' : 'text-fg hover:bg-surface-muted'
              }`}
              onClick={() => {
                onChange(preset);
                popover.close();
              }}
            >
              {estimateLabel(preset)}
            </button>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              applyCustom();
            }}
            className="mt-1 flex items-center gap-1.5 border-t border-border px-1.5 pb-0.5 pt-2"
          >
            <input
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-[length:var(--text-caption)] text-fg outline-none placeholder:text-muted focus:border-focus"
              value={custom}
              onChange={(event) => setCustom(event.target.value.replaceAll(/[^0-9]/g, ''))}
              placeholder={t.todos.estimateCustomPlaceholder}
              aria-label={t.todos.estimateCustomPlaceholder}
              inputMode="numeric"
              maxLength={6}
            />
            <button
              type="submit"
              disabled={custom.trim() === ''}
              className="h-7 shrink-0 rounded-md px-2 text-[length:var(--text-caption)] font-medium text-accent transition-colors duration-[var(--ease-out)] hover:bg-surface-muted disabled:opacity-50"
            >
              {t.todos.estimateApply}
            </button>
          </form>
          {value !== null ? (
            <button
              type="button"
              role="menuitem"
              className="mt-1 flex h-8 w-full items-center rounded-md border-t border-border px-2.5 pt-1 text-left text-[length:var(--text-caption)] text-danger hover:bg-surface-muted"
              onClick={() => {
                onChange(null);
                popover.close();
              }}
            >
              {t.todos.estimateClear}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SaveStatus({
  state,
  savedAt,
  onRetry,
}: {
  state: 'idle' | 'editing' | 'saving' | 'saved' | 'error';
  savedAt: Date | null;
  onRetry: () => void;
}) {
  if (state === 'idle') return null;
  const hm = savedAt
    ? `${String(savedAt.getHours()).padStart(2, '0')}:${String(savedAt.getMinutes()).padStart(2, '0')}`
    : '';
  const text =
    state === 'editing'
      ? t.todos.saveEditing
      : state === 'saving'
        ? t.todos.saveSaving
        : state === 'saved'
          ? `${t.todos.saveSaved}${hm === '' ? '' : ` · ${hm}`}`
          : `${t.todos.saveFailed} · ${t.todos.retry}`;
  const color =
    state === 'error' ? 'text-danger' : state === 'saved' ? 'text-done' : 'text-tertiary';
  if (state === 'error') {
    return (
      <button
        type="button"
        data-region="save-status"
        data-state={state}
        onClick={onRetry}
        title={t.todos.retry}
        className={`shrink-0 rounded-md px-1.5 py-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] transition-[background-color] duration-[var(--ease-out)] hover:bg-surface-muted ${color}`}
      >
        {text}
      </button>
    );
  }
  return (
    <span
      data-region="save-status"
      data-state={state}
      aria-live="polite"
      className={`shrink-0 px-1.5 py-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] ${color}`}
    >
      {text}
    </span>
  );
}

function ListPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; name: string; depth?: number }[];
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
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
      >
        <Icon icon={Folder} size={15} />
      </button>
      {popover.open ? (
        <div
          role="menu"
          className={`absolute right-0 z-[var(--z-dropdown)] mt-1 max-h-56 w-44 overflow-y-auto ${FIELD_POPOVER_CLASS} p-1`}
        >
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={`flex h-8 w-full items-center rounded-md px-2 text-left text-[length:var(--text-caption)] hover:bg-surface-muted ${
                item.id === value ? 'text-fg' : 'text-muted'
              } ${(item.depth ?? 0) > 0 ? 'pl-5' : ''}`}
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
