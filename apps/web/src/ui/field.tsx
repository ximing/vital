import { useId, type InputHTMLAttributes } from 'react';

export function Field({
  label,
  error,
  className = '',
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
}) {
  const generated = useId();
  const fieldId = id ?? generated;
  const errorId = `${fieldId}-error`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label
        htmlFor={fieldId}
        className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
      >
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="h-[var(--field-h)] rounded-xl border border-border bg-surface-muted/40 px-3 text-fg placeholder:text-muted outline-none transition-[border-color,background-color] duration-[var(--ease-out)] focus:border-focus focus:bg-surface"
        {...props}
      />
      {error ? (
        <p
          id={errorId}
          className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
