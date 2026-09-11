import type { ReactNode } from 'react';

/** Section header for the today page: title + optional count + hairline rule + right actions. */
export function TodaySectionHead({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="mb-2.5 mt-7 flex items-center gap-2.5 px-1">
      <h2 className="flex items-baseline gap-2 text-[length:var(--text-body)] font-semibold leading-[var(--text-body-lh)] text-fg">
        {title}
        {count !== undefined ? (
          <span className="text-[length:var(--text-caption)] font-medium tabular-nums text-tertiary">
            {count}
          </span>
        ) : null}
      </h2>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
      {children}
    </div>
  );
}

export const TODAY_HEAD_LINK =
  'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[length:var(--text-meta)] text-tertiary transition-colors hover:bg-surface-muted hover:text-fg';
