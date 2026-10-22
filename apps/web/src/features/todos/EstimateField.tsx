import { Timer } from 'lucide-react';
import { useRef, useState } from 'react';
import { t } from '@/copy';
import { FIELD_CONTROL_OPEN_CLASS, FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { META_CHIP_CLASS } from '@/ui/outcome-field';
import { usePopover } from '@/ui/use-popover';

const ESTIMATE_PRESETS = [15, 30, 60, 120] as const;

function estimateLabel(minutes: number): string {
  return t.todos.estimateMinutes.replace('{n}', String(minutes));
}

export function EstimateField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popover = usePopover(popoverRef);
  const [custom, setCustom] = useState('');

  function applyCustom() {
    const minutes = Number(custom);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 100000) return;
    onChange(minutes);
    setCustom('');
    popover.close();
  }

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        aria-label={t.todos.estimate}
        aria-haspopup="menu"
        aria-expanded={popover.open}
        onClick={() => popover.toggle()}
        className={`${META_CHIP_CLASS} ${value !== null ? 'text-fg' : ''} ${
          popover.open ? FIELD_CONTROL_OPEN_CLASS : ''
        }`}
      >
        <Icon
          icon={Timer}
          size={13}
          className={`shrink-0 ${value !== null ? 'text-accent' : ''}`}
        />
        <span className="truncate">{value !== null ? estimateLabel(value) : t.todos.estimate}</span>
      </button>
      {popover.open ? (
        <div
          role="menu"
          aria-label={t.todos.estimate}
          className={`absolute left-0 z-[var(--z-dropdown)] mt-1 w-44 ${FIELD_POPOVER_CLASS} p-1`}
        >
          {ESTIMATE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              role="menuitem"
              className={`flex h-8 w-full items-center rounded-md px-2.5 text-left text-[length:var(--text-meta)] ${
                preset === value ? 'bg-accent-subtle text-fg' : 'text-fg hover:bg-surface-muted'
              }`}
              onClick={() => {
                onChange(preset);
                popover.close();
              }}
            >
              {estimateLabel(preset)}
            </button>
          ))}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              applyCustom();
            }}
            className="mt-1 flex items-center gap-1.5 border-t border-border px-1.5 pb-0.5 pt-2"
          >
            <input
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-[length:var(--text-caption)] text-fg outline-none placeholder:text-muted focus:border-focus"
              value={custom}
              onChange={(event) => setCustom(event.target.value.replaceAll(/[^0-9]/g, ''))}
              placeholder={t.todos.estimateCustomPlaceholder}
              aria-label={t.todos.estimateCustomPlaceholder}
              inputMode="numeric"
              maxLength={6}
            />
            <button
              type="submit"
              disabled={custom.trim() === ''}
              className="h-7 shrink-0 rounded-md px-2 text-[length:var(--text-caption)] font-medium text-accent transition-colors duration-[var(--ease-out)] hover:bg-surface-muted disabled:opacity-50"
            >
              {t.todos.estimateApply}
            </button>
          </form>
          {value !== null ? (
            <button
              type="button"
              role="menuitem"
              className="mt-1 flex h-8 w-full items-center rounded-md border-t border-border px-2.5 pt-1 text-left text-[length:var(--text-caption)] text-danger hover:bg-surface-muted"
              onClick={() => {
                onChange(null);
                popover.close();
              }}
            >
              {t.todos.estimateClear}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
