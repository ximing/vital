import type { Outcome } from '@vital/dto';
import { Waypoints } from 'lucide-react';
import { useRef } from 'react';
import { t } from '@/copy';
import { FIELD_CONTROL_OPEN_CLASS, FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { usePopover } from '@/ui/use-popover';

export const META_CHIP_CLASS =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-canvas px-2.5 text-[length:var(--text-meta)] text-muted transition-[background-color,border-color,color] duration-[var(--ease-out)] hover:border-tertiary/50 hover:bg-surface-muted hover:text-fg';

export function OutcomeField({
  value,
  outcomes,
  placeholder = t.today.outcome,
  disabled,
  onChange,
}: {
  value: string | null;
  outcomes: Outcome[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (outcomeId: string | null) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popover = usePopover(popoverRef);
  const selected = outcomes.find((outcome) => outcome.id === value) ?? null;

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        aria-label={placeholder}
        aria-haspopup="listbox"
        aria-expanded={popover.open}
        disabled={disabled}
        onClick={() => popover.toggle()}
        className={`${META_CHIP_CLASS} max-w-48 ${selected ? 'text-fg' : ''} ${
          popover.open ? FIELD_CONTROL_OPEN_CLASS : ''
        } disabled:opacity-50`}
      >
        <Icon icon={Waypoints} size={13} className={`shrink-0 ${selected ? 'text-accent' : ''}`} />
        <span className="truncate">{selected ? selected.name : placeholder}</span>
      </button>
      {popover.open ? (
        <div
          role="listbox"
          aria-label={placeholder}
          className={`absolute left-0 z-[var(--z-dropdown)] mt-1 max-h-64 w-52 overflow-y-auto ${FIELD_POPOVER_CLASS} p-1`}
        >
          <button
            type="button"
            role="option"
            aria-selected={selected === null}
            className={`flex h-8 w-full items-center rounded-md px-2.5 text-left text-[length:var(--text-meta)] ${
              selected === null
                ? 'bg-accent-subtle text-fg'
                : 'text-muted hover:bg-surface-muted hover:text-fg'
            }`}
            onClick={() => {
              onChange(null);
              popover.close();
            }}
          >
            {t.today.noOutcome}
          </button>
          {outcomes.map((outcome) => (
            <button
              key={outcome.id}
              type="button"
              role="option"
              aria-selected={outcome.id === value}
              className={`flex h-8 w-full items-center rounded-md px-2.5 text-left text-[length:var(--text-meta)] ${
                outcome.id === value ? 'bg-accent-subtle text-fg' : 'text-fg hover:bg-surface-muted'
              }`}
              onClick={() => {
                onChange(outcome.id);
                popover.close();
              }}
            >
              <span className="truncate">{outcome.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
