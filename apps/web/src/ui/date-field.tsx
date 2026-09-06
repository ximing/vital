import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/copy';
import { addMonthsYmd, monthGrid, ymdParts } from '@/lib/calendar-grid';
import { formatHumanDay, toDateInput, todayYmd } from '@/features/todos/model';
import { Icon } from '@/ui/icon';

export function DateField({
  value,
  kind,
  zone,
  weekStartsOn = 1,
  ariaLabel,
  onChange,
}: {
  value: string;
  kind: 'date' | 'datetime-local';
  zone: string;
  weekStartsOn?: 0 | 1;
  ariaLabel: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const today = todayYmd(zone);
  const selectedYmd = value === '' ? '' : value.slice(0, 10);
  const selectedTime = value.includes('T') ? value.slice(11, 16) : '09:00';
  const [monthCursor, setMonthCursor] = useState((selectedYmd || today).slice(0, 7) + '-01');

  function toggleOpen() {
    if (!open) setMonthCursor((selectedYmd || today).slice(0, 7) + '-01');
    setOpen((prev) => !prev);
  }

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const { y, m } = ymdParts(monthCursor);
  const cells = monthGrid(y, m, weekStartsOn);
  const weekday = t.todos.weekday;
  const labels =
    weekStartsOn === 1
      ? [weekday[1], weekday[2], weekday[3], weekday[4], weekday[5], weekday[6], weekday[0]]
      : weekday;

  function pickDay(ymd: string) {
    if (kind === 'date') {
      onChange(ymd);
      setOpen(false);
    } else {
      onChange(`${ymd}T${selectedTime || '09:00'}`);
    }
  }

  const summary =
    selectedYmd === ''
      ? t.todos.addDate
      : kind === 'date'
        ? formatHumanDay(selectedYmd, zone)
        : `${formatHumanDay(selectedYmd, zone)} ${selectedTime}`;

  return (
    <div ref={root} className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={ariaLabel}
          aria-expanded={open}
          onClick={toggleOpen}
          className={`h-9 min-w-0 flex-1 truncate rounded-xl px-2.5 text-left text-[length:var(--text-meta)] ${
            selectedYmd === '' ? 'text-muted' : 'text-fg'
          } hover:bg-surface-muted`}
        >
          {summary}
        </button>
        {selectedYmd !== '' ? (
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-fg"
            aria-label={t.todos.clearDate}
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
          >
            <Icon icon={X} size={14} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="absolute right-0 z-[var(--z-dropdown)] mt-1 w-72 rounded-2xl border border-border bg-surface p-3 shadow-[var(--shadow)]">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-fg"
              onClick={() => setMonthCursor(addMonthsYmd(monthCursor, -1))}
              aria-label={t.todos.weekPrev}
            >
              <Icon icon={ChevronLeft} size={16} />
            </button>
            <p className="text-[length:var(--text-meta)] font-medium">
              {y}年{m}月
            </p>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-fg"
              onClick={() => setMonthCursor(addMonthsYmd(monthCursor, 1))}
              aria-label={t.todos.weekNext}
            >
              <Icon icon={ChevronRight} size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-y-1 text-center text-[length:var(--text-caption)] text-muted">
            {labels.map((label) => (
              <span key={label}>{label}</span>
            ))}
            {cells.map((ymd, i) => {
              if (ymd === null) return <span key={`e-${i}`} />;
              const isToday = ymd === today;
              const isSel = ymd === selectedYmd;
              return (
                <button
                  key={ymd}
                  type="button"
                  aria-label={`${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8))}日`}
                  aria-current={isToday ? 'date' : undefined}
                  onClick={() => pickDay(ymd)}
                  className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[length:var(--text-caption)] ${
                    isSel
                      ? 'bg-accent text-on-accent'
                      : isToday
                        ? 'text-accent ring-1 ring-accent'
                        : 'text-fg hover:bg-surface-muted'
                  }`}
                >
                  {Number(ymd.slice(8))}
                </button>
              );
            })}
          </div>
          {kind === 'datetime-local' && selectedYmd !== '' ? (
            <div className="mt-3 flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-[length:var(--text-caption)] text-muted">
                {t.todos.remindTime}
                <input
                  type="time"
                  value={selectedTime}
                  onChange={(e) => onChange(`${selectedYmd}T${e.target.value || '09:00'}`)}
                  className="h-8 flex-1 rounded-xl border border-border bg-canvas px-2 text-fg"
                />
              </label>
              <button
                type="button"
                className="h-8 rounded-xl px-2.5 text-[length:var(--text-caption)] text-accent hover:bg-accent-subtle"
                onClick={() => setOpen(false)}
              >
                {t.todos.dateDone}
              </button>
            </div>
          ) : null}
          {selectedYmd === '' ? (
            <button
              type="button"
              className="mt-2 w-full rounded-xl py-1.5 text-[length:var(--text-caption)] text-accent hover:bg-accent-subtle"
              onClick={() => pickDay(toDateInput(new Date().toISOString(), zone))}
            >
              {formatHumanDay(today, zone)}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
