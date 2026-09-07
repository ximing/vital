import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
const ITEM_H = 32;

function partsOf(value: string): { hour: string; minute: string } {
  const [hour = '09', minute = '00'] = value.split(':');
  return { hour: hour.padStart(2, '0'), minute: minute.padStart(2, '0') };
}

function WheelColumn({
  label,
  values,
  active,
  onPick,
}: {
  label: string;
  values: string[];
  active: string;
  onPick: (value: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmatic = useRef(false);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const index = values.indexOf(active);
    if (index < 0) return;
    const target = index * ITEM_H;
    if (Math.abs(list.scrollTop - target) < 1) return;
    programmatic.current = true;
    list.scrollTop = target;
    timer.current = setTimeout(() => {
      programmatic.current = false;
    }, 150);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [active, values]);

  function onScroll() {
    if (programmatic.current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const list = listRef.current;
      if (!list) return;
      const index = Math.max(0, Math.min(values.length - 1, Math.round(list.scrollTop / ITEM_H)));
      const value = values[index];
      if (value !== undefined && value !== active) onPick(value);
    }, 120);
  }

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-center text-[length:var(--text-caption)] text-muted">{label}</p>
      <div
        ref={listRef}
        role="listbox"
        aria-label={label}
        onScroll={onScroll}
        className="h-40 overflow-y-auto rounded-lg"
      >
        <div aria-hidden className="h-16" />
        {values.map((value) => (
          <button
            key={value}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={value === active}
            aria-label={`${Number(value)}${label}`}
            className={`flex h-8 w-full items-center justify-center rounded-md text-[length:var(--text-meta)] tabular-nums ${
              value === active
                ? 'bg-accent text-on-accent'
                : 'text-fg hover:bg-surface-muted'
            }`}
            onClick={() => onPick(value)}
          >
            {value}
          </button>
        ))}
        <div aria-hidden className="h-16" />
      </div>
    </div>
  );
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
  const current = `${hour}:${minute}`;
  // Draft is non-null only while the user is typing; otherwise the input tracks the picked value.
  const [draft, setDraft] = useState<string | null>(null);

  function commitText(raw: string) {
    setDraft(null);
    const match = /^(\d{1,2})\s*[:：.]?\s*(\d{0,2})$/.exec(raw.trim());
    if (match === null) return;
    const h = Math.max(0, Math.min(23, Number(match[1])));
    const min = Math.max(
      0,
      Math.min(59, match[2] === '' || match[2] === undefined ? 0 : Number(match[2])),
    );
    onChange(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-center">
        <input
          value={draft ?? current}
          inputMode="numeric"
          aria-label={t.todos.timePicker}
          className="h-8 w-20 rounded-md bg-surface-muted text-center text-[length:var(--text-body)] tabular-nums outline-none focus:ring-2 focus:ring-accent"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commitText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitText(event.currentTarget.value);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(null);
            }
          }}
        />
      </div>
      <div className="flex gap-2">
        <WheelColumn
          label="时"
          values={HOURS}
          active={hour}
          onPick={(next) => onChange(`${next}:${minute}`)}
        />
        <WheelColumn
          label="分"
          values={minutes}
          active={minute}
          onPick={(next) => onChange(`${hour}:${next}`)}
        />
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
  const popoverRef = useRef<HTMLDivElement>(null);
  const popover = usePopover(popoverRef);
  const empty = value === '';
  const summary = empty ? t.todos.addTime : value;

  return (
    <div ref={popoverRef} className={`relative ${className}`}>
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
