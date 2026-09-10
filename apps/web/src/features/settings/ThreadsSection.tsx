import type { Outcome } from '@vital/dto';
import { useState, type FormEvent } from 'react';
import { t } from '@/copy';
import { useOutcomeActions, useOutcomesQuery } from '@/features/today/queries';
import { FIELD_CONTROL_CLASS } from '@/ui/field';

const copy = t.settings.threads;

function outcomeStats(outcome: Outcome): string[] {
  const chips = [copy.openTasks.replace('{n}', String(outcome.openTaskCount))];
  chips.push(copy.doneLast7d.replace('{n}', String(outcome.completedLast7d)));
  if (outcome.materialCount > 0) chips.push(copy.materials.replace('{n}', String(outcome.materialCount)));
  return chips;
}

function StatChips({ outcome, extra }: { outcome: Outcome; extra?: string }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {outcomeStats(outcome).map((chip) => (
        <span
          key={chip}
          className="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-tertiary"
        >
          {chip}
        </span>
      ))}
      {extra ? (
        <span className="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-tertiary">
          {extra}
        </span>
      ) : null}
    </span>
  );
}

function OpenOutcomeRow({ outcome }: { outcome: Outcome }) {
  const actions = useOutcomeActions();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(outcome.name);

  function submitRename(event: FormEvent) {
    event.preventDefault();
    const next = name.trim();
    if (next === '' || next === outcome.name) {
      setName(outcome.name);
      setRenaming(false);
      return;
    }
    actions.patch.mutate(
      { id: outcome.id, input: { name: next } },
      { onSuccess: () => setRenaming(false) },
    );
  }

  return (
    <li
      data-outcome-row={outcome.id}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border py-2.5 last:border-b-0"
    >
      <span className="min-w-0 flex-1">
        {renaming ? (
          <form onSubmit={submitRename} className="flex items-center gap-1.5">
            <input
              aria-label={copy.nameAria}
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={`${FIELD_CONTROL_CLASS} h-8 w-64`}
            />
            <button
              type="submit"
              disabled={actions.patch.isPending || name.trim() === ''}
              className="h-8 shrink-0 rounded-md bg-accent-subtle px-3 text-[length:var(--text-caption)] font-medium text-fg transition-colors duration-[var(--ease-out)] hover:bg-surface-muted disabled:opacity-50"
            >
              {copy.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setName(outcome.name);
                setRenaming(false);
              }}
              className="h-8 shrink-0 rounded-md px-2.5 text-[length:var(--text-caption)] text-muted transition-colors duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
            >
              {copy.cancel}
            </button>
          </form>
        ) : (
          <span className="flex items-center gap-2 text-[length:var(--text-body)] font-medium text-fg">
            <span className="truncate">{outcome.name}</span>
            {outcome.createdBy === 'agent' ? (
              <span className="shrink-0 rounded-full bg-accent-subtle px-2 py-0.5 text-[11px] font-medium text-fg">
                {copy.agentBadge}
              </span>
            ) : null}
          </span>
        )}
        <StatChips outcome={outcome} />
      </span>
      {!renaming ? (
        <span className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => {
              setName(outcome.name);
              setRenaming(true);
            }}
            className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          >
            {copy.rename}
          </button>
          <button
            type="button"
            disabled={actions.close.isPending}
            onClick={() => actions.close.mutate(outcome.id)}
            className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-danger disabled:opacity-60"
          >
            {copy.close}
          </button>
        </span>
      ) : null}
    </li>
  );
}

function ClosedOutcomeRow({ outcome }: { outcome: Outcome }) {
  const actions = useOutcomeActions();
  const closedDate = outcome.updatedAt.slice(0, 10);
  return (
    <li
      data-outcome-row={outcome.id}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border py-2.5 opacity-60 last:border-b-0"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--text-body)] font-medium text-fg">
          {outcome.name}
        </span>
        <StatChips outcome={outcome} extra={copy.closedAt.replace('{date}', closedDate)} />
      </span>
      <button
        type="button"
        disabled={actions.reopen.isPending}
        onClick={() => actions.reopen.mutate(outcome.id)}
        className="inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:opacity-60"
      >
        {copy.reopen}
      </button>
    </li>
  );
}

export function ThreadsSection() {
  const openQuery = useOutcomesQuery('open');
  const closedQuery = useOutcomesQuery('closed');

  if (openQuery.isPending || closedQuery.isPending) {
    return (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">…</p>
    );
  }

  const open = openQuery.data ?? [];
  const closed = closedQuery.data ?? [];

  return (
    <div className="flex flex-col gap-5" data-region="threads-manage">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-tertiary">
          {copy.openGroup} · {open.length}
        </p>
        {open.length === 0 ? (
          <p className="mt-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {copy.empty}
          </p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {open.map((outcome) => (
              <OpenOutcomeRow key={outcome.id} outcome={outcome} />
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-tertiary">
          {copy.closedGroup} · {closed.length}
        </p>
        {closed.length === 0 ? (
          <p className="mt-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {copy.closedEmpty}
          </p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {closed.map((outcome) => (
              <ClosedOutcomeRow key={outcome.id} outcome={outcome} />
            ))}
          </ul>
        )}
      </div>

      <p className="rounded-[10px] bg-accent-subtle px-3.5 py-2.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-fg">
        {copy.newHint}
      </p>
    </div>
  );
}
