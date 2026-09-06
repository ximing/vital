import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-deep text-on-accent hover:bg-accent-hover disabled:opacity-60',
  ghost: 'bg-accent-subtle text-fg hover:bg-surface-muted disabled:opacity-60',
  quiet: 'bg-transparent text-muted hover:bg-surface-muted hover:text-fg disabled:opacity-60',
  danger: 'border border-danger/30 text-danger hover:bg-danger/10 disabled:opacity-60',
};

export function Button({
  variant = 'primary',
  className = '',
  loading = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 min-h-9 items-center justify-center rounded-md px-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] font-medium transition-[color,background-color,opacity] duration-[var(--ease-out)] disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
    </button>
  );
}
