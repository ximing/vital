import type { ReactNode } from 'react';

export function Banner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md bg-[color-mix(in_srgb,var(--danger)_12%,var(--bg-surface))] px-3 py-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-danger"
    >
      {children}
    </div>
  );
}
