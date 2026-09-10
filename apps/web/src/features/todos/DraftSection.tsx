import type { AgentAction, Task } from '@vital/dto';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { todoKeys } from '@/features/todos/queries';
import { todayKeys } from '@/features/today/queries';

/** How long the trigger keeps polling for the worker's proposal before giving up. */
const DRAFT_WAIT_MS = 60_000;
const DRAFT_POLL_MS = 3_000;

function draftText(action: AgentAction): string {
  const draft = action.payload['draft'];
  return typeof draft === 'string' ? draft : '';
}

/**
 * TaskDetail section for the delegable flag + agent-drafted execution plan.
 * The toggle persists via onToggleDelegable; the trigger enqueues a task.draft
 * job and polls until the worker's proposal shows up. The poll fetches the
 * pending-actions list itself and renders from its own copy — relying on an
 * invalidate of the parent's query alone could leave `action` stuck at null
 * (no active observer to refetch, or a refetch superseded mid-flight) while
 * the draft already sits in the DB. Apply/ignore go through the shared
 * feedback endpoint — the server writes the draft into the notes on accept.
 */
export function DraftSection({
  task,
  action,
  onToggleDelegable,
}: {
  task: Task;
  /** Pending task.draft proposal for this task, if any. */
  action: AgentAction | null;
  onToggleDelegable: (value: boolean) => void;
}) {
  const qc = useQueryClient();
  const [triggered, setTriggered] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [polled, setPolled] = useState<AgentAction | null>(null);
  const [busy, setBusy] = useState<'apply' | 'dismiss' | null>(null);
  const waitingSince = useRef<number | null>(null);

  const open = task.status === 'todo' || task.status === 'doing';
  // The parent's prop wins; `polled` is the copy the poll fetched itself.
  const proposal = action ?? polled;
  const draft = proposal !== null ? draftText(proposal) : '';
  // Derived: the spinner stops as soon as the proposal lands (or the task closes).
  const waiting = triggered && proposal === null && open;

  // While waiting, poll the pending-actions endpoint directly.
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const queryKey = todayKeys.decompose(task.id);
    const poll = async () => {
      if (
        waitingSince.current !== null &&
        Date.now() - waitingSince.current > DRAFT_WAIT_MS
      ) {
        waitingSince.current = null;
        setTriggered(false);
        setTimedOut(true);
        return;
      }
      try {
        const actions = await client.listAgentActions({
          targetType: 'task',
          targetId: task.id,
          feedback: 'pending',
        });
        if (cancelled) return;
        // Keep the shared cache in sync for any mounted observer.
        qc.setQueryData<AgentAction[]>(queryKey, actions);
        const found = actions.find((item) => item.actionType === 'task.draft') ?? null;
        if (found !== null) {
          waitingSince.current = null;
          setTriggered(false);
          setPolled(found);
        }
      } catch {
        // Transient failure — the next tick retries.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), DRAFT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [waiting, qc, task.id]);

  if (!open) return null;

  async function trigger() {
    setTimedOut(false);
    setPolled(null);
    setTriggered(true);
    waitingSince.current = Date.now();
    try {
      const result = await client.draftTask(task.id);
      await qc.invalidateQueries({ queryKey: todayKeys.decompose(task.id) });
      if (result.status === 'pending' && result.action !== null) {
        waitingSince.current = null;
        setTriggered(false);
        setPolled(result.action);
      }
    } catch {
      waitingSince.current = null;
      setTriggered(false);
    }
  }

  async function settle(feedback: 'accepted' | 'dismissed') {
    if (proposal === null) return;
    await client.sendAgentActionFeedback(proposal.id, { feedback });
    setTriggered(false);
    setTimedOut(false);
    setPolled(null);
    waitingSince.current = null;
    await qc.invalidateQueries({ queryKey: todayKeys.decompose(task.id) });
    if (feedback === 'accepted') {
      // The server appended the draft to the notes — refresh task reads.
      await qc.invalidateQueries({ queryKey: todoKeys.all });
      await qc.invalidateQueries({ queryKey: todayKeys.all });
    }
  }

  async function apply() {
    setBusy('apply');
    try {
      await settle('accepted');
    } finally {
      setBusy(null);
    }
  }

  async function dismiss() {
    setBusy('dismiss');
    try {
      await settle('dismissed');
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

      {task.delegable && proposal === null && !timedOut ? (
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

      {task.delegable && proposal === null && timedOut ? (
        <div data-region="draft-timeout" className="flex items-center gap-2">
          <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.todos.draftTimeout}
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

      {task.delegable && proposal !== null && draft !== '' ? (
        <div
          data-region="draft-card"
          className="rounded-[14px] border border-accent/25 bg-accent-subtle/50 px-3.5 py-3"
        >
          <p className="flex items-center gap-1.5 text-[length:var(--text-meta)] font-medium text-fg">
            <Icon icon={Sparkles} size={14} className="shrink-0 text-accent" />
            {t.todos.draftTitle}
          </p>
          <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
            {t.todos.draftHint}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-[length:var(--text-meta)] leading-[var(--text-meta-lh,var(--text-body-lh))] text-fg">
            {draft}
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <Button
              className="h-7 min-h-7 px-3 text-[length:var(--text-caption)]"
              loading={busy === 'apply'}
              disabled={busy !== null}
              onClick={() => void apply()}
            >
              {t.todos.draftApply}
            </Button>
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
}
