import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'quiet';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover disabled:opacity-60',
  ghost: 'bg-accent-subtle text-fg hover:bg-surface-muted disabled:opacity-60',
  quiet: 'bg-transparent text-muted hover:bg-surface-muted hover:text-fg disabled:opacity-60',
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
      className={`inline-flex min-h-[var(--touch-min)] items-center justify-center rounded-md px-4 text-[length:var(--text-body)] leading-[var(--text-body-lh)] transition-[color,background-color,opacity] duration-[var(--ease-out)] disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
    </button>
  );
}
