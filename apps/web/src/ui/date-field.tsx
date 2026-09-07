import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/copy';
import { addMonthsYmd, monthGrid, ymdParts } from '@/lib/calendar-grid';
import { formatHumanDay, toDateInput, todayYmd } from '@/features/todos/model';
import { Icon } from '@/ui/icon';
import {
  FIELD_CLEAR_CLASS,
  FIELD_CONTROL_CLASS,
  FIELD_CONTROL_OPEN_CLASS,
  FIELD_POPOVER_CLASS,
} from '@/ui/field';
import { TimePicker } from '@/ui/time-field';
import { usePopover } from '@/ui/use-popover';

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
  const popover = usePopover();
  const today = todayYmd(zone);
  const selectedYmd = value === '' ? '' : value.slice(0, 10);
  const selectedTime = value.includes('T') ? value.slice(11, 16) : '09:00';
  const [monthCursor, setMonthCursor] = useState((selectedYmd || today).slice(0, 7) + '-01');

  function toggleOpen() {
    if (!popover.open) setMonthCursor((selectedYmd || today).slice(0, 7) + '-01');
    popover.toggle();
  }

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
      popover.close();
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
    <div ref={popover.root} className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={ariaLabel}
          aria-expanded={popover.open}
          onClick={toggleOpen}
          className={`${FIELD_CONTROL_CLASS} min-w-0 flex-1 truncate px-2.5 text-left text-[length:var(--text-meta)] ${
            selectedYmd === '' ? 'text-muted' : 'text-fg'
          } ${popover.open ? FIELD_CONTROL_OPEN_CLASS : ''}`}
        >
          {summary}
        </button>
        {selectedYmd !== '' ? (
          <button
            type="button"
            className={FIELD_CLEAR_CLASS}
            aria-label={t.todos.clearDate}
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
          aria-label="日期选择器"
          className={`absolute right-0 z-[var(--z-dropdown)] mt-1 w-72 ${FIELD_POPOVER_CLASS}`}
        >
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
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-[length:var(--text-caption)] text-muted">{t.todos.remindTime}</p>
              <TimePicker
                value={selectedTime}
                onChange={(next) => onChange(`${selectedYmd}T${next}`)}
              />
              <button
                type="button"
                className="h-8 rounded-md text-[length:var(--text-caption)] text-accent hover:bg-accent-subtle"
                onClick={() => popover.close()}
              >
                {t.todos.dateDone}
              </button>
            </div>
          ) : null}
          {selectedYmd === '' ? (
            <button
              type="button"
              className="mt-2 w-full rounded-md py-1.5 text-[length:var(--text-caption)] text-accent hover:bg-accent-subtle"
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
