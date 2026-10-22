import type { AgentAction, List, Outcome, PatchTaskInput, Tag, Task } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { ChevronLeft } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FC, type FormEvent } from 'react';
import { t } from '@/copy';
import { AuthService } from '@/services/auth.service';
import { Icon } from '@/ui/icon';
import { usePopover } from '@/ui/use-popover';
import { DecomposeBanner } from '@/features/today';
import { DraftSection } from './DraftSection';
import { inboxList, listPickerRows } from './model';
import { useParentTask } from './queries';
import { draftFromTask } from './schedule-draft';
import { TaskDetailFields } from './TaskDetailFields';
import { TaskDetailHeader } from './TaskDetailHeader';
import { TaskDetailNotes } from './TaskDetailNotes';
import { TaskDetailSubtasks } from './TaskDetailSubtasks';
import { fitTextareaLines, TASK_TITLE_MAX_LINES } from './title-field';
import { TodosUiService } from './todos-ui.service';
import type { SaveState } from './SaveStatus';

export const TaskDetail: FC<{
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
}> = observer(function TaskDetail({
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
  const todos = useService(TodosUiService);
  const auth = useService(AuthService);
  const parentTask = useParentTask(task.parentId);
  const weekStartsOn = auth.user?.weekStartsOn === 0 ? 0 : 1;
  const [title, setTitle] = useState(task.title);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [notes, setNotes] = useState(task.notes);
  const [subTitle, setSubTitle] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreMenu = usePopover(moreRef);

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

  useLayoutEffect(() => {
    const node = titleRef.current;
    if (!node) return;
    const fit = () => fitTextareaLines(node, TASK_TITLE_MAX_LINES);
    fit();
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      const next = node.clientWidth;
      if (next === width) return;
      width = next;
      fit();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [title]);

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

  async function flushNotes() {
    if (notesTimer.current) {
      clearTimeout(notesTimer.current);
      notesTimer.current = null;
    }
    if (notes !== task.notes) await Promise.resolve(onPatch({ notes }));
  }

  function applyDraftToNotes(draft: string) {
    const text = draft.trim();
    if (text === '') return;
    if (notesTimer.current) {
      clearTimeout(notesTimer.current);
      notesTimer.current = null;
    }
    setNotes((prev) => {
      const base = prev.trimEnd();
      return (base === '' ? text : `${base}\n\n${text}`).slice(0, 50_000);
    });
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
      <TaskDetailHeader
        task={task}
        zone={zone}
        weekStartsOn={weekStartsOn}
        schedule={schedule}
        listenNonce={todos.scheduleNonce}
        onShortcutOpen={() => todos.takeScheduleOpen()}
        runPatch={runPatch}
        saveState={saveState}
        savedAt={savedAt}
        onRetrySave={retrySave}
        movable={movable}
        listOptions={listOptions}
        moreRef={moreRef}
        moreMenu={moreMenu}
        onComplete={onComplete}
        onDelete={onDelete}
        onCloseDetail={() => todos.closeDetail()}
      />

      {task.parentId !== null ? (
        <div className="border-b border-border px-4 py-1.5">
          <button
            type="button"
            onClick={() => {
              if (task.parentId) todos.openDetail(task.parentId);
            }}
            aria-label={
              parentTask ? `${t.todos.backToParent} ${parentTask.title}` : t.todos.backToParent
            }
            className="inline-flex max-w-full min-w-0 items-center gap-0.5 rounded-md px-1 py-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          >
            <Icon icon={ChevronLeft} size={13} className="shrink-0" />
            <span className="min-w-0 truncate">{parentTask?.title ?? t.todos.backToParent}</span>
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">
        <TaskDetailFields
          task={task}
          title={title}
          setTitle={setTitle}
          titleRef={titleRef}
          saveTitle={saveTitle}
          outcomes={outcomes}
          runPatch={runPatch}
          tags={tags}
          toggleTag={toggleTag}
          tagDraft={tagDraft}
          setTagDraft={setTagDraft}
          addTag={addTag}
        />

        {task.parentId === null && decomposeAction ? (
          <div className="mt-4">
            <DecomposeBanner task={task} action={decomposeAction} />
          </div>
        ) : null}

        <DraftSection
          task={task}
          action={draftAction}
          onToggleDelegable={(delegable) => runPatch({ delegable })}
          onBeforeApply={flushNotes}
          onNotesApplied={applyDraftToNotes}
        />

        <TaskDetailNotes notes={notes} onChange={queueNotes} />

        {task.parentId === null ? (
          <TaskDetailSubtasks
            subtasks={subtasks}
            zone={zone}
            onComplete={onComplete}
            subTitle={subTitle}
            setSubTitle={setSubTitle}
            onAddSubtask={onAddSubtask}
            openDetail={(id) => todos.openDetail(id)}
          />
        ) : null}
      </div>
    </aside>
  );
});
