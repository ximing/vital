import { X } from 'lucide-react';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';
import {
  FIELD_CLEAR_CLASS,
  FIELD_CONTROL_CLASS,
  FIELD_CONTROL_OPEN_CLASS,
  FIELD_POPOVER_CLASS,
} from '@/ui/field';
import { usePopover } from '@/ui/use-popover';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

function partsOf(value: string): { hour: string; minute: string } {
  const [hour = '09', minute = '00'] = value.split(':');
  return { hour: hour.padStart(2, '0'), minute: minute.padStart(2, '0') };
}

function chipClass(active: boolean): string {
  return `flex h-8 items-center justify-center rounded-md text-[length:var(--text-caption)] ${
    active ? 'bg-accent text-on-accent' : 'text-fg hover:bg-surface-muted'
  }`;
}

export function TimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { hour, minute } = partsOf(value === '' ? '09:00' : value);
  const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort();

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-6 gap-1" role="listbox" aria-label="时">
        {HOURS.map((item) => (
          <button
            key={item}
            type="button"
            role="option"
            aria-selected={item === hour}
            aria-label={`${Number(item)}时`}
            className={chipClass(item === hour)}
            onClick={() => onChange(`${item}:${minute}`)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1" role="listbox" aria-label="分">
        {minutes.map((item) => (
          <button
            key={item}
            type="button"
            role="option"
            aria-selected={item === minute}
            aria-label={`${Number(item)}分`}
            className={chipClass(item === minute)}
            onClick={() => onChange(`${hour}:${item}`)}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TimeField({
  label,
  value,
  onChange,
  disabled,
  clearable = false,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
}) {
  const popover = usePopover();
  const empty = value === '';
  const summary = empty ? t.todos.addTime : value;

  return (
    <div ref={popover.root} className={`relative ${className}`}>
      <p className="mb-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">{label}</p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={label}
          aria-expanded={popover.open}
          disabled={disabled}
          onClick={() => popover.toggle()}
          className={`${FIELD_CONTROL_CLASS} min-w-0 flex-1 truncate px-2.5 text-left text-[length:var(--text-meta)] ${
            empty ? 'text-muted' : 'text-fg'
          } ${popover.open ? FIELD_CONTROL_OPEN_CLASS : ''} disabled:opacity-50`}
        >
          {summary}
        </button>
        {clearable && !empty ? (
          <button
            type="button"
            className={FIELD_CLEAR_CLASS}
            aria-label={t.todos.clearTime}
            onClick={() => {
              onChange('');
              popover.close();
            }}
          >
            <Icon icon={X} size={14} />
          </button>
        ) : null}
      </div>
      {popover.open ? (
        <div
          role="dialog"
          aria-label={t.todos.timePicker}
          className={`absolute left-0 z-[var(--z-dropdown)] mt-1 w-72 ${FIELD_POPOVER_CLASS}`}
        >
          <TimePicker
            value={empty ? '09:00' : value}
            onChange={(next) => {
              onChange(next);
            }}
          />
          <button
            type="button"
            className="mt-3 h-8 w-full rounded-md text-[length:var(--text-caption)] text-accent hover:bg-accent-subtle"
            onClick={() => {
              if (empty) onChange('09:00');
              popover.close();
            }}
          >
            {t.todos.dateDone}
          </button>
        </div>
      ) : null}
    </div>
  );
}
