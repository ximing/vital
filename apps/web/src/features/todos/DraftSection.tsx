import type { AgentAction, Task, TaskDraftTrigger } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Sparkles } from 'lucide-react';
import { useEffect, useState, type FC } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { todoKeys } from '@/features/todos/queries';
import { decomposeSubtasks } from '@/features/today/model';
import { todayKeys } from '@/features/today/queries';
import { TodosUiService } from './todos-ui.service';

const DRAFT_POLL_MS = 3_000;

function draftText(action: AgentAction): string {
  const draft = action.payload['draft'];
  return typeof draft === 'string' ? draft : '';
}

/**
 * TaskDetail section for the delegable flag + agent-drafted execution plan.
 * The toggle persists via onToggleDelegable; the trigger enqueues a task.draft
 * job. In-flight / failed status is read from GET /tasks/:id/draft so closing
 * the drawer and reopening keeps "起草中" or the retry affordance. The poll
 * also writes the pending action into the shared query cache — relying on an
 * invalidate of the parent's query alone could leave `action` stuck at null
 * while the draft already sits in the DB. Apply/ignore go through the shared
 * feedback endpoint — the server writes the draft into the notes and
 * materializes any proposed subtasks on accept. The notes editor is local
 * state, so the parent must apply the draft text itself (`onNotesApplied`)
 * or the card closing looks like a no-op.
 */
export const DraftSection: FC<{
  task: Task;
  /** Pending task.draft proposal for this task, if any. */
  action: AgentAction | null;
  onToggleDelegable: (value: boolean) => void;
  /** Flush unsaved notes so the server appends onto the latest body. */
  onBeforeApply?: () => Promise<void>;
  /** Mirror the server-side notes append into the open editor. */
  onNotesApplied?: (draft: string) => void;
}> = observer(function DraftSection({
  task,
  action,
  onToggleDelegable,
  onBeforeApply,
  onNotesApplied,
}: {
  task: Task;
  /** Pending task.draft proposal for this task, if any. */
  action: AgentAction | null;
  onToggleDelegable: (value: boolean) => void;
  /** Flush unsaved notes so the server appends onto the latest body. */
  onBeforeApply?: () => Promise<void>;
  /** Mirror the server-side notes append into the open editor. */
  onNotesApplied?: (draft: string) => void;
}) {
  const todos = useService(TodosUiService);
  const qc = useQueryClient();
  const jobStatus = todos.draftStatus[task.id] ?? 'idle';
  const polled = todos.draftPolled[task.id] ?? null;
  const [busy, setBusy] = useState<'apply' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = task.status === 'todo' || task.status === 'doing';
  // The parent's prop wins; `polled` is the copy GET fetched itself.
  const proposal = action ?? polled;
  const draft = proposal !== null ? draftText(proposal) : '';
  const subtasks = proposal !== null ? decomposeSubtasks(proposal) : [];
  const hasProposal = draft !== '' || subtasks.length > 0;
  const waiting = jobStatus === 'queued' && proposal === null && open;
  const failed = jobStatus === 'failed' && proposal === null && open;

  useEffect(() => {
    if (!open || !task.delegable) return;
    let cancelled = false;
    const queryKey = todayKeys.decompose(task.id);

    const applyResult = (result: TaskDraftTrigger, ignoreIdle: boolean) => {
      if (result.status === 'pending' && result.action !== null) {
        const landed = result.action;
        qc.setQueryData<AgentAction[]>(queryKey, (prev) => {
          const rest = (prev ?? []).filter((item) => item.actionType !== 'task.draft');
          return [landed, ...rest];
        });
        todos.setDraftJob(task.id, { polled: landed, status: 'idle' });
        return;
      }
      if (result.status === 'queued') {
        todos.setDraftJob(task.id, { status: 'queued' });
        return;
      }
      if (result.status === 'failed') {
        todos.setDraftJob(task.id, { polled: null, status: 'failed' });
        return;
      }
      if (!ignoreIdle) todos.setDraftJob(task.id, { status: 'idle' });
    };

    const tick = async (ignoreIdle: boolean) => {
      try {
        const result = await client.getTaskDraft(task.id);
        if (cancelled) return;
        applyResult(result, ignoreIdle);
      } catch {
        // Transient failure — keep the current phase; the next tick retries.
      }
    };

    void tick(waiting);
    const timer = waiting ? setInterval(() => void tick(true), DRAFT_POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [waiting, open, task.delegable, qc, task.id, todos]);

  if (!open) return null;

  async function trigger() {
    setError(null);
    todos.setDraftJob(task.id, { polled: null, status: 'queued' });
    try {
      const result = await client.draftTask(task.id);
      await qc.invalidateQueries({ queryKey: todayKeys.decompose(task.id) });
      if (result.status === 'pending' && result.action !== null) {
        todos.setDraftJob(task.id, { polled: result.action, status: 'idle' });
      }
    } catch {
      todos.setDraftJob(task.id, { status: 'idle' });
    }
  }

  async function settle(feedback: 'accepted' | 'dismissed') {
    if (proposal === null) return;
    await client.sendAgentActionFeedback(proposal.id, { feedback });
    setError(null);
    todos.setDraftJob(task.id, { polled: null, status: 'idle' });
    await qc.invalidateQueries({ queryKey: todayKeys.decompose(task.id) });
    if (feedback === 'accepted') {
      // The server appended the draft to the notes (and created subtasks) —
      // refresh task reads. Notes themselves are local state; the parent
      // mirrors the append via onNotesApplied.
      await qc.invalidateQueries({ queryKey: todoKeys.all });
      await qc.invalidateQueries({ queryKey: todayKeys.all });
    }
  }

  async function apply() {
    setBusy('apply');
    setError(null);
    try {
      await onBeforeApply?.();
      await settle('accepted');
      onNotesApplied?.(draft);
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(null);
    }
  }

  async function dismiss() {
    setBusy('dismiss');
    setError(null);
    try {
      await settle('dismissed');
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-region="draft-section" className="mt-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={task.delegable}
          aria-label={t.todos.delegable}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--ease-out)] ${
            task.delegable ? 'bg-accent' : 'bg-surface-muted'
          }`}
          onClick={() => onToggleDelegable(!task.delegable)}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-elevated shadow transition-[left] duration-[var(--ease-out)] ${
              task.delegable ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </button>
        <span className="flex items-center gap-1.5 text-[length:var(--text-meta)] text-fg">
          <Icon icon={Bot} size={14} className="shrink-0 text-muted" />
          {t.todos.delegable}
        </span>
      </div>
      {task.delegable && proposal === null ? (
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {t.todos.delegableHint}
        </p>
      ) : null}

      {task.delegable && proposal === null && !failed ? (
        <div>
          <Button
            variant="quiet"
            className="h-7 min-h-7 px-3 text-[length:var(--text-caption)]"
            loading={waiting}
            disabled={waiting}
            onClick={() => void trigger()}
          >
            <Icon icon={Sparkles} size={13} className="mr-1 text-accent" />
            {waiting ? t.todos.draftWaiting : t.todos.draftTrigger}
          </Button>
        </div>
      ) : null}

      {task.delegable && proposal === null && failed ? (
        <div data-region="draft-failed" className="flex items-center gap-2">
          <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.todos.draftFailed}
          </p>
          <Button
            variant="quiet"
            className="h-7 min-h-7 px-3 text-[length:var(--text-caption)]"
            onClick={() => void trigger()}
          >
            <Icon icon={Sparkles} size={13} className="mr-1 text-accent" />
            {t.todos.draftRetry}
          </Button>
        </div>
      ) : null}

      {task.delegable && proposal !== null && hasProposal ? (
        <div
          data-region="draft-card"
          className="rounded-[14px] border border-accent/25 bg-accent-subtle/50 px-3.5 py-3"
        >
          <p className="flex items-center gap-1.5 text-[length:var(--text-meta)] font-medium text-fg">
            <Icon icon={Sparkles} size={14} className="shrink-0 text-accent" />
            {t.todos.draftTitle}
          </p>
          <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {subtasks.length > 0 ? t.todos.draftHintWithSubtasks : t.todos.draftHint}
          </p>
          {draft !== '' ? (
            <p className="mt-2 whitespace-pre-wrap text-[length:var(--text-meta)] leading-[var(--text-meta-lh,var(--text-body-lh))] text-fg">
              {draft}
            </p>
          ) : null}
          {subtasks.length > 0 ? (
            <div className="mt-2.5">
              <p className="text-[length:var(--text-caption)] text-muted">{t.todos.draftSubtasks}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {subtasks.map((subtask, index) => (
                  <li
                    key={`${String(index)}-${subtask.title}`}
                    className="flex items-center gap-2 text-[length:var(--text-meta)] text-fg"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {String(index + 1)}. {subtask.title}
                    </span>
                    {subtask.estimateMinutes !== null ? (
                      <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-tertiary">
                        {t.todos.estimateMinutes.replace('{n}', String(subtask.estimateMinutes))}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error !== null ? (
            <p className="mt-2 text-[length:var(--text-caption)] text-danger">{error}</p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {draft !== '' ? (
              <Button
                className="h-7 min-h-7 px-3 text-[length:var(--text-caption)]"
                loading={busy === 'apply'}
                disabled={busy !== null}
                onClick={() => void apply()}
              >
                {t.todos.draftApply}
              </Button>
            ) : null}
            {subtasks.length > 0 ? (
              <Button
                variant={draft !== '' ? 'quiet' : 'primary'}
                className="h-7 min-h-7 px-3 text-[length:var(--text-caption)]"
                loading={busy === 'apply'}
                disabled={busy !== null}
                onClick={() => void apply()}
              >
                {t.todos.draftApplySubtasks}
              </Button>
            ) : null}
            <Button
              variant="quiet"
              className="h-7 min-h-7 px-2.5 text-[length:var(--text-caption)]"
              loading={busy === 'dismiss'}
              disabled={busy !== null}
              onClick={() => void dismiss()}
            >
              {t.todos.draftDismiss}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
});
