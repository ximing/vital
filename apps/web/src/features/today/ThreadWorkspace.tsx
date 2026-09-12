import type { Outcome, OutcomeDetail, OutcomeSignal, Task } from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { bindServices, useService } from '@rabjs/react';
import { useQuery } from '@tanstack/react-query';
import { QueryService } from '@/services/query.service';
import { useState, type FC, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { AuthService } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { inboxKeys, useInboxListQuery } from '@/features/inbox/queries';
import { TaskSkeleton } from '@/features/todos/EmptyTasks';
import { inboxList } from '@/features/todos/model';
import { TaskDetail } from '@/features/todos/TaskDetail';
import { useListsQuery, useTagsQuery, useTodoActions } from '@/features/todos/queries';
import { UndoToast } from '@/features/todos/UndoToast';
import { TodosUiService } from '@/features/todos/todos-ui.service';
import { isUndoable } from './model';
import { ThreadPageService } from './thread-page.service';
import { useOutcomeActions, useOutcomeDetailQuery, usePendingDecomposeQuery } from './queries';

const DETAIL_COL =
  'flex h-full min-h-0 w-[clamp(24rem,40%,40rem)] shrink-0 border-l border-border/60';

const SIGNAL_CLASS: Record<OutcomeSignal, string> = {
  up: 'text-accent bg-accent-subtle',
  flat: 'text-tertiary bg-surface-muted',
  alert: 'text-due bg-[var(--amber-100)]',
};

function formatHmOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

function taskMeta(task: Task, timeZone: string): string {
  const parts: string[] = [
    task.estimateMinutes !== null && task.estimateMinutes > 0
      ? t.thread.minutes.replace('{n}', String(task.estimateMinutes))
      : t.thread.noEstimate,
  ];
  if (task.dueAt !== null) {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone });
    if (fmt.format(new Date(task.dueAt)) <= fmt.format(new Date())) {
      parts.push(t.thread.dueToday);
    }
  }
  return parts.join('　');
}

/** All outcomes regardless of status — for the "belongs to" label when attaching materials. */
function useAllOutcomesQuery() {
  return useQuery({
    queryKey: ['today', 'outcomes', 'all'] as const,
    queryFn: (): Promise<Outcome[]> => client.listOutcomes(),
  });
}

/** Lightweight confirm dialog per the thread design (close / undo). */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-[color:var(--scrim)] px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-[440px] rounded-xl border border-border bg-elevated p-6 shadow-[var(--shadow)]"
      >
        <h2 className="font-display text-[length:var(--text-section)] font-semibold">{title}</h2>
        <p className="mt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {body}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ThreadHeader({
  detail,
  timeZone,
  now,
}: {
  detail: OutcomeDetail;
  timeZone: string;
  now: Date;
}) {
  const outcome = detail.outcome;
  const actions = useOutcomeActions();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<'close' | 'undo' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const closed = outcome.status === 'closed';
  const undoable = !closed && isUndoable(outcome, now);
  const headline =
    outcome.agentHeadline ??
    outcome.ruleNextStep ??
    (detail.tasks.length === 0 ? t.thread.fallbackNext : null);

  function startEdit(): void {
    setDraft(outcome.name);
    setSaveError(null);
    setEditing(true);
  }

  async function submitRename(event: FormEvent): Promise<void> {
    event.preventDefault();
    const next = draft.trim();
    if (next === '') {
      setSaveError(t.thread.nameRequired);
      return;
    }
    try {
      await actions.patch.mutateAsync({ id: outcome.id, input: { name: next } });
      setEditing(false);
      setSaveError(null);
    } catch {
      // Keep the draft so the user can retry.
      setSaveError(t.thread.saveFailed);
    }
  }

  async function runConfirm(): Promise<void> {
    setActionError(null);
    try {
      if (confirmKind === 'close') {
        await actions.close.mutateAsync(outcome.id);
        setConfirmKind(null);
      } else if (confirmKind === 'undo') {
        await actions.undo.mutateAsync(outcome.id);
        setConfirmKind(null);
        // Undoing dissolves the thread — back to today.
        navigate('/today');
      }
    } catch (err) {
      setConfirmKind(null);
      setActionError(humanError(err));
    }
  }

  return (
    <header data-region="thread-head" className="pt-5">
      <div className="flex flex-wrap items-center gap-3">
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(event) => void submitRename(event)}
          >
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={120}
              aria-label={t.thread.rename}
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-[length:var(--text-body)] text-fg outline-none focus:border-accent"
            />
            <Button type="submit" loading={actions.patch.isPending}>
              {t.thread.save}
            </Button>
            <Button variant="quiet" onClick={() => setEditing(false)}>
              {t.thread.cancel}
            </Button>
          </form>
        ) : (
          <>
            <h1 className="font-display text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)]">
              {outcome.name}
            </h1>
            <button
              type="button"
              onClick={startEdit}
              className="shrink-0 rounded-md px-2 py-1 text-[length:var(--text-meta)] text-tertiary transition-colors hover:bg-surface-muted hover:text-fg"
            >
              {t.thread.rename}
            </button>
            {closed ? (
              <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-surface-muted px-2 text-[11px] font-semibold tracking-wide text-tertiary">
                {t.thread.closed}
              </span>
            ) : outcome.ruleSignal ? (
              <span
                className={`inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-[11px] font-semibold tracking-wide ${SIGNAL_CLASS[outcome.ruleSignal]}`}
              >
                {t.today.signal[outcome.ruleSignal]}
              </span>
            ) : null}
            <span className="flex-1" />
            <Button
              variant="quiet"
              className="border border-border"
              onClick={() => {
                if (closed) {
                  setActionError(null);
                  actions.reopen.mutate(outcome.id, {
                    onError: (err) => setActionError(humanError(err)),
                  });
                } else {
                  setConfirmKind('close');
                }
              }}
            >
              {closed ? t.thread.reopenThread : t.thread.closeThread}
            </Button>
          </>
        )}
      </div>

      {saveError ? (
        <div className="mt-2">
          <Banner>{saveError}</Banner>
        </div>
      ) : null}
      {actionError ? (
        <div className="mt-2">
          <Banner>{actionError}</Banner>
        </div>
      ) : null}

      {outcome.agentState === 'pending' ? (
        <div aria-label={t.today.updating} className="mt-3">
          <div className="skeleton-pulse h-[13px] w-[55%] rounded-sm" />
        </div>
      ) : headline !== null ? (
        <p className="mt-3 max-w-[68ch] text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
          {headline}
        </p>
      ) : null}

      {outcome.agentState === 'failed' ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-muted px-3.5 py-2.5 text-[length:var(--text-meta)] text-muted">
          {t.thread.agentFailed}
          <button
            type="button"
            className="font-medium text-accent underline-offset-4 hover:underline"
            onClick={() =>
              actions.refresh.mutate(outcome.id, {
                onError: (err) => setActionError(humanError(err)),
              })
            }
          >
            {t.today.retry}
          </button>
        </div>
      ) : null}

      {closed ? (
        <p className="mt-2.5 text-[length:var(--text-meta)] text-muted">{t.thread.closedNotice}</p>
      ) : null}
      {undoable ? (
        <p className="mt-2.5 text-[length:var(--text-caption)] text-tertiary">
          {t.thread.createdByAgentAt.replace('{time}', formatHmOf(outcome.createdAt, timeZone))} ·{' '}
          <button
            type="button"
            className="font-medium text-accent underline-offset-4 hover:underline"
            onClick={() => setConfirmKind('undo')}
          >
            {t.today.undo}
          </button>
        </p>
      ) : null}

      {confirmKind === 'close' ? (
        <ConfirmDialog
          title={t.thread.closeConfirmTitle}
          body={t.thread.closeConfirmBody}
          confirmLabel={t.thread.closeThread}
          cancelLabel={t.thread.cancel}
          onConfirm={() => void runConfirm()}
          onCancel={() => setConfirmKind(null)}
        />
      ) : null}
      {confirmKind === 'undo' ? (
        <ConfirmDialog
          title={t.thread.undoConfirmTitle}
          body={t.thread.undoConfirmBody}
          confirmLabel={t.thread.undoConfirm}
          cancelLabel={t.thread.undoKeep}
          danger
          onConfirm={() => void runConfirm()}
          onCancel={() => setConfirmKind(null)}
        />
      ) : null}
    </header>
  );
}

function NextStepCard({
  detail,
  timeZone,
  onNewTask,
}: {
  detail: OutcomeDetail;
  timeZone: string;
  onNewTask: () => void;
}) {
  const todos = useService(TodosUiService);
  const closed = detail.outcome.status === 'closed';
  const nextTask = detail.tasks.find((task) => task.status === 'todo' || task.status === 'doing');
  const text = detail.outcome.ruleNextStep ?? detail.outcome.agentSuggestion;

  return (
    <section
      data-region="thread-next"
      className="mt-6 rounded-xl border border-transparent bg-accent-subtle p-5 shadow-[var(--shadow-xs)]"
    >
      <div className="text-[length:var(--text-caption)] text-tertiary">
        {closed ? t.thread.recentNextStep : t.thread.nextStep}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        {nextTask ? (
          <>
            <div className="min-w-0">
              <h3 className="text-[length:var(--text-section)] font-semibold">{nextTask.title}</h3>
              <p className="mt-1 text-[length:var(--text-meta)] text-muted">
                {taskMeta(nextTask, timeZone)}
              </p>
            </div>
            <Button
              variant="quiet"
              className="border border-border bg-elevated"
              onClick={() => todos.openDetail(nextTask.id)}
            >
              {t.thread.viewTask}
            </Button>
          </>
        ) : text !== null ? (
          <h3 className="text-[length:var(--text-section)] font-semibold">{text}</h3>
        ) : (
          <>
            <div className="min-w-0">
              <h3 className="text-[length:var(--text-section)] font-semibold">
                {t.thread.addFirst}
              </h3>
              <p className="mt-1 text-[length:var(--text-meta)] text-muted">
                {t.thread.addFirstHint}
              </p>
            </div>
            <Button onClick={onNewTask}>{t.thread.newTask}</Button>
          </>
        )}
      </div>
    </section>
  );
}

function NewTaskForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (title: string, estimateMinutes: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [estimate, setEstimate] = useState('');

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = title.trim();
    if (name === '') return;
    const minutes = Number(estimate);
    await onSubmit(
      name,
      estimate !== '' && Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : null,
    );
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 shadow-[var(--shadow-xs)]"
    >
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={t.thread.newTaskPlaceholder}
        aria-label={t.thread.newTaskPlaceholder}
        maxLength={500}
        className="min-w-0 flex-1 bg-transparent text-[length:var(--text-body)] text-fg outline-none placeholder:text-tertiary"
      />
      <input
        value={estimate}
        onChange={(event) => setEstimate(event.target.value)}
        placeholder={t.thread.estimatePlaceholder}
        aria-label={t.thread.estimatePlaceholder}
        inputMode="numeric"
        className="w-[130px] rounded-md border border-border bg-surface px-2 py-1.5 text-[length:var(--text-meta)] text-fg outline-none placeholder:text-tertiary focus:border-accent"
      />
      <Button type="submit" disabled={title.trim() === ''} loading={pending}>
        {t.thread.addTask}
      </Button>
      <Button variant="quiet" onClick={onCancel}>
        {t.thread.cancel}
      </Button>
    </form>
  );
}

function TaskRow({
  task,
  timeZone,
  done,
  onToggle,
}: {
  task: Task;
  timeZone: string;
  done: boolean;
  onToggle: (task: Task) => void;
}) {
  const todos = useService(TodosUiService);
  return (
    <div className="flex items-center gap-3 border-b border-border/60 px-2 py-2.5">
      <button
        type="button"
        aria-label={`${done ? '重开' : '完成'} ${task.title}`}
        onClick={() => onToggle(task)}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] transition-colors ${
          done ? 'border-accent bg-accent text-on-accent' : 'border-tertiary hover:border-accent'
        }`}
      >
        {done ? '✓' : ''}
      </button>
      <button
        type="button"
        onClick={() => todos.openDetail(task.id)}
        className={`min-w-0 flex-1 truncate text-left text-[length:var(--text-body)] ${
          done ? 'text-muted line-through' : 'text-fg'
        }`}
      >
        {task.title}
      </button>
      <span className="shrink-0 text-[length:var(--text-caption)] text-tertiary">
        {done && task.completedAt !== null
          ? formatHmOf(task.completedAt, timeZone)
          : taskMeta(task, timeZone)}
      </span>
    </div>
  );
}

function TasksSection({
  detail,
  timeZone,
  creating,
  onCreatingChange,
  onRefresh,
}: {
  detail: OutcomeDetail;
  timeZone: string;
  creating: boolean;
  onCreatingChange: (open: boolean) => void;
  onRefresh: () => void;
}) {
  const actions = useTodoActions();
  const listsQuery = useListsQuery();
  const [error, setError] = useState<string | null>(null);

  // The create API needs a list; tasks of the thread carry theirs, else the inbox.
  const createListId = detail.tasks[0]?.listId ?? inboxList(listsQuery.data ?? [])?.id ?? '';

  const open = detail.tasks.filter((task) => task.status === 'todo' || task.status === 'doing');
  const done = detail.tasks
    .filter((task) => task.status === 'done')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  async function toggle(task: Task): Promise<void> {
    setError(null);
    try {
      if (task.status === 'done') {
        await actions.setStatus(task, 'todo');
      } else {
        await actions.complete(task);
      }
    } catch (err) {
      setError(humanError(err));
    } finally {
      onRefresh();
    }
  }

  async function createTask(title: string, estimateMinutes: number | null): Promise<void> {
    setError(null);
    try {
      await actions.create.mutateAsync({
        title,
        listId: createListId,
        outcomeId: detail.outcome.id,
        ...(estimateMinutes !== null ? { estimateMinutes } : {}),
      });
      onCreatingChange(false);
    } catch (err) {
      setError(humanError(err));
    } finally {
      onRefresh();
    }
  }

  return (
    <section aria-label={t.thread.tasksSection} className="mt-8">
      <div className="flex items-center gap-3 px-2">
        <h2 className="eyebrow eyebrow-rule min-w-0 flex-1">{t.thread.tasksSection}</h2>
        <button
          type="button"
          className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[length:var(--text-meta)] font-medium text-accent transition-colors hover:bg-accent-subtle"
          onClick={() => onCreatingChange(!creating)}
          aria-expanded={creating}
        >
          {t.thread.newTask}
        </button>
      </div>

      {error ? (
        <div className="mt-2 px-2">
          <Banner>{error}</Banner>
        </div>
      ) : null}

      {creating ? (
        <NewTaskForm
          pending={actions.create.isPending}
          onSubmit={createTask}
          onCancel={() => onCreatingChange(false)}
        />
      ) : null}

      <p className="mt-3 px-2 text-[length:var(--text-caption)] text-tertiary">
        {t.thread.openGroup.replace('{n}', String(open.length))}
      </p>
      {open.length === 0 ? (
        <p className="px-2 py-4 text-center text-[length:var(--text-meta)] text-muted">
          {t.thread.emptyTasks}
        </p>
      ) : (
        open.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            timeZone={timeZone}
            done={false}
            onToggle={(item) => void toggle(item)}
          />
        ))
      )}

      <details open className="mt-3">
        <summary className="cursor-pointer px-2 text-[length:var(--text-caption)] text-tertiary">
          {t.thread.doneGroup.replace('{n}', String(done.length))}
        </summary>
        {done.length === 0 ? (
          <p className="px-2 py-3 text-[length:var(--text-meta)] text-muted">{t.thread.emptyDone}</p>
        ) : (
          done.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              timeZone={timeZone}
              done
              onToggle={(item) => void toggle(item)}
            />
          ))
        )}
      </details>
    </section>
  );
}

function AttachDialog({
  detail,
  onDone,
  onCancel,
}: {
  detail: OutcomeDetail;
  onDone: () => void;
  onCancel: () => void;
}) {
  const inboxQuery = useInboxListQuery();
  const outcomesQuery = useAllOutcomesQuery();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attachedIds = new Set(detail.materials.map((material) => material.id));
  const outcomeNames = new Map((outcomesQuery.data ?? []).map((outcome) => [outcome.id, outcome.name]));
  const candidates = (inboxQuery.data ?? []).filter(
    (item) =>
      item.deletedAt === null &&
      item.status !== 'converted' &&
      !attachedIds.has(item.id) &&
      (search.trim() === '' || item.title.includes(search.trim())),
  );

  function toggle(id: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      for (const id of picked) {
        await client.patchInbox(id, { outcomeId: detail.outcome.id });
      }
      onDone();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex items-center justify-center bg-[color:var(--scrim)] px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.thread.attachTitle}
        className="flex max-h-[80vh] w-full max-w-[480px] flex-col rounded-xl border border-border bg-elevated p-6 shadow-[var(--shadow)]"
      >
        <h2 className="font-display text-[length:var(--text-section)] font-semibold">
          {t.thread.attachTitle}
        </h2>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t.thread.attachSearch}
          aria-label={t.thread.attachSearch}
          className="mt-4 w-full rounded-md border border-border bg-surface px-3 py-2 text-[length:var(--text-body)] text-fg outline-none placeholder:text-tertiary focus:border-accent"
        />
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="py-6 text-center text-[length:var(--text-meta)] text-muted">
              {t.thread.attachEmpty}
            </p>
          ) : (
            candidates.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-[length:var(--text-body)] hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  checked={picked.has(item.id)}
                  onChange={() => toggle(item.id)}
                  className="accent-[var(--accent-primary)]"
                />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="shrink-0 text-[length:var(--text-caption)] text-tertiary">
                  {item.outcomeId !== null && outcomeNames.has(item.outcomeId)
                    ? t.thread.attachBelongsTo.replace(
                        '{name}',
                        outcomeNames.get(item.outcomeId) ?? '',
                      )
                    : t.thread.attachUnfiled}
                </span>
              </label>
            ))
          )}
        </div>
        <p className="mt-3 text-[length:var(--text-caption)] text-tertiary">
          {t.thread.attachMoveHint}
        </p>
        {error ? (
          <div className="mt-2">
            <Banner>{error}</Banner>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="quiet" onClick={onCancel}>
            {t.thread.cancel}
          </Button>
          <Button onClick={() => void submit()} disabled={picked.size === 0} loading={pending}>
            {t.thread.attachSubmit}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MaterialsSection({
  detail,
  onRefresh,
}: {
  detail: OutcomeDetail;
  onRefresh: () => void;
}) {
  const query = useService(QueryService);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detachedToast, setDetachedToast] = useState(false);

  async function detach(id: string): Promise<void> {
    setError(null);
    try {
      await client.patchInbox(id, { outcomeId: null });
      setDetachedToast(true);
      onRefresh();
      await query.invalidate(inboxKeys.all);
    } catch (err) {
      setError(humanError(err));
    }
  }

  return (
    <section aria-label={t.thread.materialsSection} className="mt-8">
      <div className="flex items-center gap-3 px-2">
        <h2 className="eyebrow eyebrow-rule min-w-0 flex-1">{t.thread.materialsSection}</h2>
        <button
          type="button"
          className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[length:var(--text-meta)] font-medium text-accent transition-colors hover:bg-accent-subtle"
          onClick={() => setAttaching(true)}
        >
          {t.thread.attach}
        </button>
      </div>

      {error ? (
        <div className="mt-2 px-2">
          <Banner>{error}</Banner>
        </div>
      ) : null}
      {detachedToast ? (
        <p role="status" className="mt-2 px-2 text-[length:var(--text-caption)] text-tertiary">
          {t.thread.detachedToast}
        </p>
      ) : null}

      {detail.materials.length === 0 ? (
        <p className="px-2 py-6 text-center text-[length:var(--text-meta)] text-muted">
          {t.thread.emptyMaterials}
        </p>
      ) : (
        detail.materials.map((material) => (
          <div
            key={material.id}
            className="flex items-center gap-3 border-b border-border/60 px-2 py-3"
          >
            <div className="min-w-0 flex-1">
              <Link
                to={`/inbox/${material.id}`}
                className="block truncate text-[length:var(--text-body)] text-fg underline-offset-4 hover:underline"
              >
                {material.title}
              </Link>
              <p className="mt-0.5 text-[length:var(--text-caption)] text-tertiary">
                {material.siteName ?? t.inbox.source[material.source]}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-[length:var(--text-meta)] text-tertiary transition-colors hover:bg-surface-muted hover:text-fg"
              onClick={() => void detach(material.id)}
            >
              {t.thread.detach}
            </button>
          </div>
        ))
      )}

      {attaching ? (
        <AttachDialog
          detail={detail}
          onDone={() => {
            setAttaching(false);
            onRefresh();
            void query.invalidate(inboxKeys.all);
          }}
          onCancel={() => setAttaching(false)}
        />
      ) : null}
    </section>
  );
}

function AgentTimeline({ detail, timeZone }: { detail: OutcomeDetail; timeZone: string }) {
  return (
    <section aria-label={t.thread.agentLog} className="mt-8">
      <h2 className="eyebrow eyebrow-rule px-2">{t.thread.agentLog}</h2>
      {detail.agentActions.length === 0 ? (
        <p className="px-2 py-6 text-center text-[length:var(--text-meta)] text-muted">
          {t.thread.emptyLog}
        </p>
      ) : (
        <ol className="mt-3">
          {detail.agentActions.map((action) => (
            <li
              key={action.id}
              className="relative ml-1.5 border-l border-border pb-5 pl-5 last:border-transparent last:pb-0"
            >
              <span className="absolute -left-[4px] top-1.5 h-[7px] w-[7px] rounded-full bg-accent" />
              <span className="inline-flex items-center gap-3 text-[length:var(--text-caption)] text-tertiary">
                <span>{formatHmOf(action.createdAt, timeZone)}</span>
                <span>{t.thread.feedback[action.feedback]}</span>
              </span>
              {action.payloadSummary !== '' ? (
                <p className="mt-1 text-[length:var(--text-body)] text-fg">
                  {action.payloadSummary}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ThreadCanvas({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-[1000px] px-6 pb-16 md:px-8">{children}</div>
    </main>
  );
}

const BACK_LINK_CLASS =
  'mt-4 inline-flex items-center rounded-md px-2 py-1 text-[length:var(--text-meta)] text-muted transition-colors hover:bg-surface-muted hover:text-fg';

function ThreadWorkspaceContent() {
  const page = useService(ThreadPageService);
  const todos = useService(TodosUiService);
  const auth = useService(AuthService);
  const { id = '' } = useParams();
  const user = auth.user;
  const timeZone = user?.timezone ?? 'UTC';

  const detailQuery = useOutcomeDetailQuery(id);
  const listsQuery = useListsQuery();
  const tagsQuery = useTagsQuery();
  const todoActions = useTodoActions();

  const selectedId = todos.selectedId;
  const detailOpen = todos.detailOpen;
  const now = page.now;
  const creatingTask = page.creatingTask;

  const detail = detailQuery.data ?? null;
  const tasks = detail?.tasks ?? [];
  const detailTask = detailOpen ? tasks.find((task) => task.id === selectedId) : undefined;
  const decomposeQuery = usePendingDecomposeQuery(
    detailOpen && detailTask && detailTask.parentId === null ? detailTask.id : null,
  );
  const decomposeAction =
    (decomposeQuery.data ?? []).find((action) => action.actionType === 'task.decompose') ?? null;
  const draftAction =
    (decomposeQuery.data ?? []).find((action) => action.actionType === 'task.draft') ?? null;

  function refresh(): void {
    void page.refresh();
  }

  const backLink = (
    <Link to="/today" className={BACK_LINK_CLASS}>
      {t.thread.back}
    </Link>
  );

  if (detailQuery.isLoading) {
    return (
      <div className="flex h-full min-h-0 bg-canvas">
        <ThreadCanvas>
          {backLink}
          <div className="pt-4">
            <TaskSkeleton />
          </div>
        </ThreadCanvas>
      </div>
    );
  }

  if (detailQuery.error !== null || detail === null) {
    const missing = detailQuery.error instanceof ApiError && detailQuery.error.status === 404;
    return (
      <div className="flex h-full min-h-0 bg-canvas">
        <ThreadCanvas>
          {backLink}
          <div className="py-16 text-center">
            <h2 className="font-display text-[length:var(--text-section)] font-semibold">
              {missing ? t.thread.notFoundTitle : t.thread.loadFailedTitle}
            </h2>
            <p className="mt-3 text-[length:var(--text-meta)] text-muted">
              {missing ? t.thread.notFoundHint : t.thread.loadFailedHint}
            </p>
            {missing ? (
              <Link
                to="/today"
                className="mt-5 inline-flex h-9 items-center rounded-md bg-accent-deep px-3.5 text-[length:var(--text-meta)] font-medium text-on-accent"
              >
                {t.thread.backToday}
              </Link>
            ) : (
              <Button className="mt-5" onClick={() => void detailQuery.refetch()}>
                {t.today.retry}
              </Button>
            )}
          </div>
        </ThreadCanvas>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <ThreadCanvas>
        {backLink}
        <ThreadHeader detail={detail} timeZone={timeZone} now={now} />
        <NextStepCard
          detail={detail}
          timeZone={timeZone}
          onNewTask={() => page.startCreate()}
        />
        <TasksSection
          detail={detail}
          timeZone={timeZone}
          creating={creatingTask}
          onCreatingChange={(value) => page.setCreating(value)}
          onRefresh={refresh}
        />
        <MaterialsSection detail={detail} onRefresh={refresh} />
        <AgentTimeline detail={detail} timeZone={timeZone} />
      </ThreadCanvas>

      {detailOpen && detailTask ? (
        <div data-region="detail-slot" className={DETAIL_COL}>
          <TaskDetail
            key={detailTask.id}
            task={detailTask}
            subtasks={tasks.filter((task) => task.parentId === detailTask.id)}
            lists={listsQuery.data ?? []}
            tags={tagsQuery.data ?? []}
            outcomes={[detail.outcome]}
            decomposeAction={decomposeAction}
            draftAction={draftAction}
            timeZone={timeZone}
            onPatch={(input) =>
              todoActions.patch.mutateAsync({ id: detailTask.id, input }).then(refresh)
            }
            onComplete={(task: Task) => {
              void todoActions.complete(task).finally(refresh);
            }}
            onDelete={() => todoActions.remove.mutate(detailTask.id, { onSettled: refresh })}
            onAddSubtask={(name) => {
              void todoActions.create
                .mutateAsync({
                  title: name,
                  listId: detailTask.listId,
                  parentId: detailTask.id,
                  outcomeId: detail.outcome.id,
                })
                .then(refresh);
            }}
            onCreateTag={async (name) => todoActions.createTag.mutateAsync(name)}
          />
        </div>
      ) : null}

      <UndoToast onUndo={() => void todoActions.undoComplete().then(refresh)} />
    </div>
  );
}

export const ThreadWorkspace: FC = bindServices(ThreadWorkspaceContent, [ThreadPageService]);
