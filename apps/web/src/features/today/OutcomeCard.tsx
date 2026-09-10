import type { Outcome, OutcomeSignal } from '@vital/dto';
import type { KeyboardEvent } from 'react';
import { t } from '@/copy';
import { cardDisplay } from './model';

const SIGNAL_CLASS: Record<OutcomeSignal, string> = {
  up: 'text-accent bg-accent-subtle',
  flat: 'text-tertiary bg-surface-muted',
  alert: 'text-due bg-[var(--amber-100)]',
};

export function OutcomeCard({
  outcome,
  now,
  onOpen,
  onUndo,
  onRetry,
}: {
  outcome: Outcome;
  now: Date;
  onOpen: () => void;
  onUndo: () => void;
  onRetry: () => void;
}) {
  const view = cardDisplay(outcome, now);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-region="outcome-card"
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className="relative flex min-h-[168px] cursor-pointer flex-col rounded-xl border border-border bg-elevated p-[18px] shadow-[var(--shadow-xs)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-accent hover:shadow-[var(--shadow)]"
    >
      <div className="flex items-center gap-2">
        <span className="font-display truncate text-[length:var(--text-section)] font-semibold leading-[var(--text-section-lh)]">
          {outcome.name}
        </span>
        {view.signal ? (
          <span
            className={`inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-[11px] font-semibold tracking-wide ${SIGNAL_CLASS[view.signal]}`}
          >
            {t.today.signal[view.signal]}
          </span>
        ) : null}
        {view.undoable ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[11px] text-tertiary">
            {t.today.newByAgent} ·{' '}
            <button
              type="button"
              className="font-medium text-accent underline-offset-4 hover:underline"
              onClick={(event) => {
                event.stopPropagation();
                onUndo();
              }}
            >
              {t.today.undo}
            </button>
          </span>
        ) : null}
      </div>

      <div className="mt-2.5 min-h-5 text-[length:var(--text-meta)] leading-5 text-muted">
        {view.pending ? (
          <div aria-label={t.today.updating}>
            <div className="skeleton-pulse h-[13px] w-[92%] rounded-sm" />
            <div className="skeleton-pulse mt-1.5 h-[13px] w-[64%] rounded-sm" />
          </div>
        ) : view.headline ? (
          <p className="line-clamp-2">{view.headline}</p>
        ) : null}
      </div>

      {view.nextStep ? (
        <div className="mt-auto pt-3">
          <div className="text-[11px] tracking-wider text-tertiary">{t.today.nextStep}</div>
          <div className="mt-0.5 truncate text-[length:var(--text-body)] font-medium text-fg">
            {view.nextStep}
          </div>
        </div>
      ) : (
        <div className="mt-auto" />
      )}

      <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2.5 font-mono text-[11px] text-tertiary">
        <span>{t.today.openTasks.replace('{n}', String(outcome.openTaskCount))}</span>
        {outcome.materialCount > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{t.today.materials.replace('{n}', String(outcome.materialCount))}</span>
          </>
        ) : null}
        {view.pending ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{t.today.updating}</span>
          </>
        ) : null}
        {view.failed ? (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 font-medium text-due underline-offset-4 hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              onRetry();
            }}
          >
            ⟳ {t.today.retry}
          </button>
        ) : null}
      </div>
    </div>
  );
}
