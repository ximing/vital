import type { OutcomeDetail } from '@vital/dto';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { HOME_PATH } from '@/routes';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { isUndoable } from './model';
import { useOutcomeActions } from './queries';
import { formatHmOf, SIGNAL_CLASS } from './thread-format';

export function ThreadHeader({
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
        navigate(HOME_PATH);
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

      {headline !== null ? (
        <p className="mt-3 max-w-[68ch] text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
          {headline}
        </p>
      ) : outcome.agentState === 'pending' ? (
        <div aria-label={t.today.updating} className="mt-3">
          <div className="skeleton-pulse h-[13px] w-[55%] rounded-sm" />
        </div>
      ) : null}
      {outcome.agentState === 'pending' && headline !== null ? (
        <p className="mt-1.5 text-[length:var(--text-caption)] text-tertiary">{t.today.updating}</p>
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
