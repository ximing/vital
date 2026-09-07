import {
  FIELD_CONTROL_CLASS,
  FIELD_CONTROL_OPEN_CLASS,
  FIELD_POPOVER_CLASS,
} from '@/ui/field';
import { usePopover } from '@/ui/use-popover';

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export function SelectField<T extends string>({
  value,
  options,
  ariaLabel,
  placeholder,
  onChange,
  disabled,
  className = '',
}: {
  value: T;
  options: readonly SelectOption<T>[];
  ariaLabel: string;
  placeholder?: string;
  onChange: (next: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  const popover = usePopover();
  const selected = options.find((option) => option.value === value);
  const summary = selected?.label ?? placeholder ?? '';

  return (
    <div ref={popover.root} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={popover.open}
        disabled={disabled}
        onClick={() => popover.toggle()}
        className={`${FIELD_CONTROL_CLASS} w-full truncate px-2.5 text-left text-[length:var(--text-meta)] ${
          selected ? 'text-fg' : 'text-muted'
        } ${popover.open ? FIELD_CONTROL_OPEN_CLASS : ''} disabled:opacity-50`}
      >
        {summary}
      </button>
      {popover.open ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute left-0 z-[var(--z-dropdown)] mt-1 max-h-64 min-w-full overflow-y-auto ${FIELD_POPOVER_CLASS} p-1`}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                className={`flex h-8 w-full items-center rounded-md px-2.5 text-left text-[length:var(--text-meta)] ${
                  option.disabled
                    ? 'text-muted/50'
                    : active
                      ? 'bg-accent-subtle text-fg'
                      : 'text-fg hover:bg-surface-muted'
                }`}
                onClick={() => {
                  if (option.disabled) return;
                  onChange(option.value);
                  popover.close();
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
