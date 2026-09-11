import type { Outcome } from '@vital/dto';
import { useState, type FormEvent } from 'react';
import { t } from '@/copy';
import { useOutcomeActions, useOutcomesQuery } from '@/features/today/queries';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { ACTIVITY_CARD, ActivitySectionHead } from './ActivitySectionHead';

const copy = t.settings.threads;

const BTN_GHOST_SM =
  'inline-flex h-[26px] items-center rounded-full px-2.5 text-[length:var(--text-caption)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60';
const BTN_PRIMARY_SM =
  'inline-flex h-[26px] items-center rounded-full bg-accent px-3 text-[length:var(--text-caption)] font-semibold text-on-accent transition-[color,background-color] duration-[var(--ease-out)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';

const STAT_NUM =
  'font-display text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] tabular-nums';
const STAT_LBL =
  'mt-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted';

function StatChips({ outcome, extra }: { outcome: Outcome; extra?: string }) {
  // 「7天完成」有动量时高亮，其余保持中性。
  const chips: { text: string; hot: boolean }[] = [
    { text: copy.openTasks.replace('{n}', String(outcome.openTaskCount)), hot: false },
    {
      text: copy.doneLast7d.replace('{n}', String(outcome.completedLast7d)),
      hot: outcome.completedLast7d > 0,
    },
  ];
  if (outcome.materialCount > 0) {
    chips.push({ text: copy.materials.replace('{n}', String(outcome.materialCount)), hot: false });
  }
  if (extra) chips.push({ text: extra, hot: false });
  return (
    <span className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.text}
          className={`inline-flex h-[22px] items-center rounded-full px-2.5 font-mono text-[11px] tabular-nums ${
            chip.hot ? 'bg-accent-subtle font-semibold text-accent' : 'bg-surface-muted text-muted'
          }`}
        >
          {chip.text}
        </span>
      ))}
    </span>
  );
}

function OpenThreadCard({ outcome }: { outcome: Outcome }) {
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
      className={`${ACTIVITY_CARD} flex flex-col gap-2.5 px-5 py-4 transition-shadow duration-[var(--ease-out)] hover:shadow-[var(--shadow)]`}
    >
      {renaming ? (
        <form onSubmit={submitRename} className="flex flex-1 flex-col gap-2.5">
          <input
            aria-label={copy.nameAria}
            autoFocus
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={`${FIELD_CONTROL_CLASS} h-9 w-full`}
          />
          <StatChips outcome={outcome} />
          <span className="mt-auto flex gap-2">
            <button
              type="submit"
              disabled={actions.patch.isPending || name.trim() === ''}
              className={BTN_PRIMARY_SM}
            >
              {copy.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setName(outcome.name);
                setRenaming(false);
              }}
              className={BTN_GHOST_SM}
            >
              {copy.cancel}
            </button>
          </span>
        </form>
      ) : (
        <>
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-[15px] font-semibold leading-[22px] text-fg">
              {outcome.name}
            </span>
            {outcome.createdBy === 'agent' ? (
              <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-accent-subtle px-2 text-[11px] font-semibold text-accent">
                {copy.agentBadge}
              </span>
            ) : null}
          </span>
          <StatChips outcome={outcome} />
          <span className="mt-auto flex gap-1 border-t border-border pt-2.5">
            <button
              type="button"
              onClick={() => {
                setName(outcome.name);
                setRenaming(true);
              }}
              className={BTN_GHOST_SM}
            >
              {copy.rename}
            </button>
            <span className="flex-1" />
            <button
              type="button"
              disabled={actions.close.isPending}
              onClick={() => actions.close.mutate(outcome.id)}
              className={`${BTN_GHOST_SM} hover:text-danger`}
            >
              {copy.close}
            </button>
          </span>
        </>
      )}
    </li>
  );
}

function ClosedThreadRow({ outcome }: { outcome: Outcome }) {
  const actions = useOutcomeActions();
  const closedDate = outcome.updatedAt.slice(0, 10);
  return (
    <li
      data-outcome-row={outcome.id}
      className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-b border-border px-5 py-3 opacity-60 transition-opacity duration-[var(--ease-out)] last:border-b-0 hover:opacity-90"
    >
      <span className="min-w-0 flex-1 truncate text-[length:var(--text-meta)] font-medium leading-[var(--text-meta-lh)] text-fg">
        {outcome.name}
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <StatChips outcome={outcome} />
        <span className="text-[length:var(--text-caption)] tabular-nums text-tertiary">
          {copy.closedAt.replace('{date}', closedDate)}
        </span>
        <button
          type="button"
          disabled={actions.reopen.isPending}
          onClick={() => actions.reopen.mutate(outcome.id)}
          className={BTN_GHOST_SM}
        >
          {copy.reopen}
        </button>
      </span>
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
  const doneTotal = open.reduce((sum, outcome) => sum + outcome.completedLast7d, 0);

  return (
    <div className="flex flex-col gap-7" data-region="threads-manage">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {open.length}
            <span className="ml-1 text-[length:var(--text-meta)] font-medium text-tertiary">
              {copy.stats.openUnit}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.openGroup}</p>
        </div>
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {doneTotal}
            <span className="ml-1 text-[length:var(--text-meta)] font-medium text-tertiary">
              {copy.stats.doneUnit}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.stats.doneLabel}</p>
        </div>
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {closed.length}
            <span className="ml-1 text-[length:var(--text-meta)] font-medium text-tertiary">
              {copy.stats.openUnit}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.closedGroup}</p>
        </div>
      </div>

      <section aria-label={copy.openGroup}>
        <ActivitySectionHead
          title={copy.openGroup}
          hint={`${open.length} ${copy.stats.openUnit}`}
        />
        {open.length === 0 ? (
          <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {copy.empty}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {open.map((outcome) => (
              <OpenThreadCard key={outcome.id} outcome={outcome} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label={copy.closedGroup}>
        <ActivitySectionHead
          title={copy.closedGroup}
          hint={`${closed.length} ${copy.stats.openUnit} · ${copy.closedHint}`}
        />
        {closed.length === 0 ? (
          <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {copy.closedEmpty}
          </p>
        ) : (
          <div className={ACTIVITY_CARD}>
            <ul className="flex flex-col">
              {closed.map((outcome) => (
                <ClosedThreadRow key={outcome.id} outcome={outcome} />
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
