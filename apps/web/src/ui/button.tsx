import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';

type Size = 'md' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-deep text-on-accent shadow-[var(--shadow-xs)] hover:bg-accent-hover disabled:opacity-60',
  ghost: 'bg-accent-subtle text-fg hover:bg-surface-muted disabled:opacity-60',
  quiet: 'bg-transparent text-muted hover:bg-surface-muted hover:text-fg disabled:opacity-60',
  danger: 'border border-danger/30 text-danger hover:bg-danger/10 disabled:opacity-60',
};

// Size classes live in the base string, so an h-* in className would fight the
// default by stylesheet order; pick a size explicitly instead.
const SIZES: Record<Size, string> = {
  md: 'h-9 min-h-9 px-3.5',
  sm: 'h-7 min-h-7 px-3',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  loading = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-md text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] font-medium transition-[color,background-color,opacity] duration-[var(--ease-out)] disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
    </button>
  );
}
