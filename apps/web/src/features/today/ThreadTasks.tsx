import type { OutcomeDetail, Task } from '@vital/dto';
import { useService } from '@rabjs/react';
import { useState, type FormEvent } from 'react';
import { t } from '@/copy';
import { inboxList, TodosUiService, useListsQuery, useTodoActions } from '@/features/todos';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { formatHmOf, taskMeta } from './thread-format';

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

function ThreadTaskRow({
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

export function ThreadTasks({
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
          <ThreadTaskRow
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
            <ThreadTaskRow
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
