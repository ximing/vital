import { useId, type InputHTMLAttributes } from 'react';

export const FIELD_CONTROL_CLASS =
  'h-[var(--field-h)] rounded-md bg-surface-muted/70 px-3 text-fg placeholder:text-muted outline-none transition-[background-color,box-shadow] duration-[var(--ease-out)] hover:bg-surface-muted focus:bg-surface focus:shadow-[0_0_0_3px_var(--focus-ring)]';

export const FIELD_CONTROL_OPEN_CLASS = 'bg-surface shadow-[0_0_0_3px_var(--focus-ring)]';

export const FIELD_POPOVER_CLASS = 'rounded-md bg-elevated p-3 shadow-[var(--shadow)]';

export const FIELD_CLEAR_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-fg';

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
        className={FIELD_CONTROL_CLASS}
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
