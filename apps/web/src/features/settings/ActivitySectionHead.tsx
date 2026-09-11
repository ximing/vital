import type { ReactNode } from 'react';

/** Section header shared by the 系统行为 blocks: title + optional hint + right-aligned action. */
export function ActivitySectionHead({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-1">
      <h3 className="text-[length:var(--text-body)] font-semibold leading-[var(--text-body-lh)] text-fg">
        {title}
      </h3>
      {hint ? (
        <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
          {hint}
        </p>
      ) : null}
      {action ? <span className="ml-auto">{action}</span> : null}
    </div>
  );
}

export const ACTIVITY_CARD =
  'rounded-[18px] border border-border bg-surface shadow-[var(--shadow-xs)]';
