import type { Outcome } from '@vital/dto';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Icon } from '@/ui/icon';
import { sortOutcomes } from './model';
import { OutcomeCard } from './OutcomeCard';
import { useOutcomeActions } from './queries';

function CreateOutcomeInput({
  autoFocus = false,
  onDone,
}: {
  autoFocus?: boolean;
  onDone?: () => void;
}) {
  const actions = useOutcomeActions();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (next === '') return;
    setError(null);
    try {
      await actions.create.mutateAsync({ name: next });
      setName('');
      onDone?.();
    } catch (err) {
      setError(humanError(err));
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="mx-auto flex max-w-[420px] items-center gap-2 rounded-lg border border-border bg-elevated py-1.5 pl-3.5 pr-1.5 shadow-[var(--shadow-xs)]">
        <input
          autoFocus={autoFocus}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t.today.newOutcomePlaceholder}
          aria-label={t.today.newOutcome}
          maxLength={120}
          className="min-w-0 flex-1 bg-transparent text-[length:var(--text-body)] text-fg outline-none placeholder:text-tertiary"
        />
        <button
          type="submit"
          disabled={name.trim() === '' || actions.create.isPending}
          className="h-8 shrink-0 rounded-md bg-accent px-3.5 text-[length:var(--text-meta)] font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {t.today.create}
        </button>
      </div>
      {error ? (
        <div className="mx-auto mt-2 max-w-[420px]">
          <Banner>{error}</Banner>
        </div>
      ) : null}
    </form>
  );
}

export function EmptyOutcomes() {
  return (
    <div
      data-region="empty-outcomes"
      className="mt-3.5 rounded-xl border border-dashed border-border bg-surface px-7 py-9 text-center"
    >
      <div className="font-display text-lg font-semibold">{t.today.emptyTitle}</div>
      <div className="mx-auto mt-1.5 max-w-md text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {t.today.emptyHint}
      </div>
      <div className="mt-4">
        <CreateOutcomeInput />
      </div>
    </div>
  );
}

export function OutcomeBoard({ outcomes, now }: { outcomes: Outcome[]; now: Date }) {
  const navigate = useNavigate();
  const actions = useOutcomeActions();
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function run(fn: () => Promise<unknown>): void {
    setActionError(null);
    void fn().catch((err: unknown) => setActionError(humanError(err)));
  }

  return (
    <section aria-label={t.today.board}>
      <div className="mt-7 flex items-center gap-3 px-2">
        <h2 className="eyebrow eyebrow-rule min-w-0 flex-1">
          {t.today.board} · {outcomes.length}
        </h2>
        <Link
          to="/settings?tab=threads"
          className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[length:var(--text-meta)] text-tertiary transition-colors hover:bg-surface-muted hover:text-fg"
        >
          {t.today.manageOutcomes}
        </Link>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[length:var(--text-meta)] text-tertiary transition-colors hover:bg-surface-muted hover:text-fg"
          onClick={() => setCreating((open) => !open)}
          aria-expanded={creating}
        >
          <Icon icon={Plus} size={13} />
          {t.today.newOutcome}
        </button>
      </div>

      {actionError ? (
        <div className="mt-2 px-2">
          <Banner>{actionError}</Banner>
        </div>
      ) : null}

      {creating ? (
        <div className="mt-3">
          <CreateOutcomeInput autoFocus onDone={() => setCreating(false)} />
        </div>
      ) : null}

      {outcomes.length === 0 ? (
        <EmptyOutcomes />
      ) : (
        <div
          data-region="outcome-board"
          className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-3.5"
        >
          {sortOutcomes(outcomes).map((outcome) => (
            <OutcomeCard
              key={outcome.id}
              outcome={outcome}
              now={now}
              onOpen={() => void navigate(`/today/threads/${outcome.id}`)}
              onUndo={() => run(() => actions.undo.mutateAsync(outcome.id))}
              onRetry={() => run(() => actions.refresh.mutateAsync(outcome.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}
