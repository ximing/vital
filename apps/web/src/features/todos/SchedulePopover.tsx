import type { RecurrenceKind, ReminderOffsetMinutes } from '@vital/dto';
import {
  AlarmClock,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Moon,
  Repeat,
  Sun,
  Sunrise,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { t } from '@/copy';
import { addMonthsYmd, padYmd, ymdParts } from '@/lib/calendar-grid';
import { DateField } from '@/ui/date-field';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { TimePicker } from '@/ui/time-field';
import { usePopover } from '@/ui/use-popover';
import { addDaysYmd, fromDatetimeLocal, toDatetimeLocal, todayYmd } from './model';
import { draftChip, type ScheduleDraft, type ScheduleMode } from './schedule-draft';
import { offsetLabel, REMINDER_OFFSETS, type ReminderValue } from './schedule-fields';

type Panel = 'none' | 'time' | 'endTime' | 'remind' | 'repeat';
type FlySide = 'right' | 'left';
/** Widest flyout (time wheel) + gap, used for the right-side space check. */
const FLYOUT_MAX_W = 272;

const RECURRENCE: { value: RecurrenceKind | 'none'; label: string }[] = [
  { value: 'none', label: t.todos.recurrenceNone },
  { value: 'daily', label: t.todos.recurrenceDaily },
  { value: 'weekly', label: t.todos.recurrenceWeekly },
  { value: 'monthly', label: t.todos.recurrenceMonthly },
  { value: 'yearly', label: t.todos.recurrenceYearly },
  { value: 'weekdays', label: t.todos.recurrenceWeekdays },
  { value: 'weekends', label: t.todos.recurrenceWeekends },
  { value: 'holidays', label: t.todos.recurrenceHolidays },
  { value: 'legal_workdays', label: t.todos.recurrenceLegalWorkdays },
];

function reminderLabel(value: ReminderValue): string {
  if (value === 'none') return t.todos.reminderNone;
  if (value === 'due') return t.todos.reminderDue;
  if (value === 'custom') return t.todos.reminderCustom;
  return offsetLabel(Number(value) as ReminderOffsetMinutes);
}

function recurrenceLabel(kind: RecurrenceKind | null): string {
  if (kind === null) return t.todos.recurrenceNone;
  return RECURRENCE.find((item) => item.value === kind)?.label ?? t.todos.recurrence;
}

function monthDays(y: number, m: number, weekStartsOn: 0 | 1): string[] {
  const first = padYmd(y, m, 1);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  let lead = firstDow - weekStartsOn;
  if (lead < 0) lead += 7;
  const start = addDaysYmd(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDaysYmd(start, i));
}

export function SchedulePopover({
  draft,
  zone,
  weekStartsOn,
  ariaLabel,
  triggerClassName,
  compact,
  align = 'start',
  onChange,
}: {
  draft: ScheduleDraft;
  zone: string;
  weekStartsOn: 0 | 1;
  ariaLabel?: string;
  triggerClassName?: string;
  compact?: boolean;
  align?: 'start' | 'end';
  onChange: (next: ScheduleDraft) => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const popover = usePopover(popoverRef);
  const dialogRef = useRef<HTMLDivElement>(null);
  const today = todayYmd(zone);
  const [working, setWorking] = useState(draft);
  const [monthCursor, setMonthCursor] = useState((draft.startYmd || today).slice(0, 7) + '-01');
  const [panel, setPanel] = useState<Panel>('none');
  const [side, setSide] = useState<FlySide>('right');
  const [rangeFocus, setRangeFocus] = useState<'start' | 'end'>('start');

  function edit(next: ScheduleDraft) {
    setWorking(next);
    onChange(next);
  }

  function open() {
    setWorking(draft);
    setMonthCursor((draft.startYmd || today).slice(0, 7) + '-01');
    setPanel('none');
    setRangeFocus('start');
    popover.toggle();
  }

  const { y, m } = ymdParts(monthCursor);
  const days = monthDays(y, m, weekStartsOn);
  const monthKey = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
  const weekday = t.todos.weekday;
  const labels =
    weekStartsOn === 1
      ? [weekday[1], weekday[2], weekday[3], weekday[4], weekday[5], weekday[6], weekday[0]]
      : weekday;

  function setMode(mode: ScheduleMode) {
    if (mode === working.mode) return;
    if (mode === 'point') {
      edit({ ...working, mode, endYmd: null, endHm: null });
      return;
    }
    edit({
      ...working,
      mode,
      startYmd: working.startYmd ?? today,
      endYmd: working.endYmd ?? working.startYmd ?? today,
    });
  }

  function pickDay(ymd: string) {
    if (working.mode === 'point') {
      edit({ ...working, startYmd: ymd });
      return;
    }
    if (rangeFocus === 'start') {
      const end = working.endYmd && working.endYmd < ymd ? ymd : working.endYmd;
      edit({ ...working, startYmd: ymd, endYmd: end ?? ymd });
      setRangeFocus('end');
      return;
    }
    const start = working.startYmd ?? ymd;
    edit({
      ...working,
      startYmd: ymd < start ? ymd : start,
      endYmd: ymd < start ? start : ymd,
    });
  }

  function quick(ymd: string, hm: string | null) {
    edit({
      ...working,
      mode: 'point',
      startYmd: ymd,
      endYmd: null,
      startHm: hm,
      endHm: null,
    });
  }

  /** Same-day ranges keep end >= start: bump the trailing edge when they cross. */
  function withStartHm(hm: string | null): ScheduleDraft {
    const next = { ...working, startHm: hm };
    if (
      hm !== null &&
      (working.endYmd ?? working.startYmd) === working.startYmd &&
      working.endHm !== null &&
      working.endHm < hm
    ) {
      next.endHm = hm;
    }
    return next;
  }

  function withEndHm(hm: string | null): ScheduleDraft {
    const next = { ...working, endHm: hm };
    if (
      hm !== null &&
      (working.endYmd ?? working.startYmd) === working.startYmd &&
      working.startHm !== null &&
      hm < working.startHm
    ) {
      next.endHm = working.startHm;
    }
    return next;
  }

  /** Sub-panels fly out as a side menu: right when there is room, else left. */
  function togglePanel(next: Exclude<Panel, 'none'>) {
    if (panel !== next) {
      const rect = dialogRef.current?.getBoundingClientRect();
      if (rect) {
        setSide(rect.right + 8 + FLYOUT_MAX_W <= window.innerWidth ? 'right' : 'left');
      }
      setPanel(next);
    } else {
      setPanel('none');
    }
  }

  function clear() {
    edit({
      ...working,
      startYmd: null,
      endYmd: null,
      startHm: null,
      endHm: null,
      reminder: 'none',
      reminderAt: null,
      recurrenceKind: null,
    });
    popover.close();
  }

  // The trigger shows the committed draft; the working copy is authoritative only while open.
  const chip = draftChip(popover.open ? working : draft, zone);
  const pointTime = working.startHm;

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel ?? t.todos.addDate}
        aria-expanded={popover.open}
        onClick={open}
        className={
          triggerClassName ??
          `inline-flex h-8 max-w-full items-center gap-1 truncate rounded-md px-1.5 text-left text-[length:var(--text-meta)] ${
            chip.overdue
              ? 'text-overdue'
              : working.startYmd
                ? 'text-accent'
                : 'text-muted hover:bg-surface-muted hover:text-fg'
          }`
        }
      >
        {compact ? (
          <Icon icon={CalendarDays} size={15} />
        ) : (
          <>
            <Icon icon={CalendarDays} size={14} className="shrink-0" />
            <span className="truncate">{chip.text}</span>
          </>
        )}
      </button>
      {popover.open ? (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label={t.todos.schedule}
          className={`absolute z-[var(--z-dropdown)] mt-1 w-[20.5rem] ${
            align === 'end' ? 'right-0' : 'left-0'
          } ${FIELD_POPOVER_CLASS} p-2`}
        >
          <div className="mb-2 grid grid-cols-2 rounded-md bg-surface-muted p-0.5">
            {(
              [
                ['point', t.todos.datePoint],
                ['range', t.todos.dateRange],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`h-8 rounded-md text-[length:var(--text-caption)] ${
                  working.mode === mode ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg'
                }`}
                onClick={() => setMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mb-2 flex items-center justify-around px-2 py-1">
            <IconBtn label={t.todos.quickToday} onClick={() => quick(today, null)}>
              <Icon icon={Sun} size={16} />
            </IconBtn>
            <IconBtn label={t.todos.quickTomorrow} onClick={() => quick(addDaysYmd(today, 1), null)}>
              <Icon icon={Sunrise} size={16} />
            </IconBtn>
            <IconBtn label={t.todos.quickWeek} onClick={() => quick(addDaysYmd(today, 7), null)}>
              <Icon icon={CalendarPlus} size={16} />
            </IconBtn>
            <IconBtn label={t.todos.quickEvening} onClick={() => quick(today, '21:00')}>
              <Icon icon={Moon} size={16} />
            </IconBtn>
          </div>

          <div className="mb-1 flex items-center gap-1 px-1">
            <p className="min-w-0 flex-1 text-[length:var(--text-meta)] font-medium">
              {y}年{m}月
            </p>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-fg"
              onClick={() => setMonthCursor(addMonthsYmd(monthCursor, -1))}
              aria-label={t.todos.weekPrev}
            >
              <Icon icon={ChevronLeft} size={16} />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-fg"
              onClick={() => {
                setMonthCursor(`${today.slice(0, 7)}-01`);
                pickDay(today);
              }}
              aria-label={t.todos.quickToday}
            >
              <Icon icon={Circle} size={12} />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-fg"
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
            {days.map((ymd) => {
              const inMonth = ymd.startsWith(monthKey);
              const inRange =
                working.mode === 'range' &&
                working.startYmd !== null &&
                ymd >= working.startYmd &&
                ymd <= (working.endYmd ?? working.startYmd);
              const isSel =
                ymd === working.startYmd || (working.mode === 'range' && ymd === working.endYmd);
              const isToday = ymd === today;
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
                      : inRange
                        ? 'bg-accent-subtle text-fg'
                        : isToday
                          ? 'text-accent ring-1 ring-accent'
                          : inMonth
                            ? 'text-fg hover:bg-surface-muted'
                            : 'text-muted/50 hover:bg-surface-muted'
                  }`}
                >
                  {Number(ymd.slice(8))}
                </button>
              );
            })}
          </div>

          {working.mode === 'point' ? (
            <FlyoutRow
              icon={Clock}
              label={pointTime ?? t.todos.addTime}
              active={panel === 'time'}
              side={side}
              width="w-64"
              flyoutLabel={t.todos.timePicker}
              onToggle={() => {
                togglePanel('time');
                if (panel !== 'time' && pointTime === null) {
                  edit({ ...working, startHm: '09:00' });
                }
              }}
            >
              <TimePicker
                value={pointTime ?? '09:00'}
                onChange={(hm) => edit({ ...working, startHm: hm })}
              />
              <button
                type="button"
                className="mt-2 h-7 w-full rounded-md text-[length:var(--text-caption)] text-muted hover:bg-surface-muted hover:text-fg"
                onClick={() => {
                  edit({ ...working, startHm: null });
                  setPanel('none');
                }}
              >
                {t.todos.allDay}
              </button>
            </FlyoutRow>
          ) : (
            <>
              <FlyoutRow
                icon={Clock}
                label={working.startHm ?? t.todos.startTime}
                active={panel === 'time'}
                side={side}
                width="w-64"
                flyoutLabel={t.todos.timePicker}
                onToggle={() => {
                  togglePanel('time');
                  setRangeFocus('start');
                  if (panel !== 'time' && working.startHm === null) {
                    edit({ ...working, startHm: '09:00' });
                  }
                }}
              >
                <TimePicker
                  value={working.startHm ?? '09:00'}
                  onChange={(hm) => edit(withStartHm(hm))}
                />
              </FlyoutRow>
              <FlyoutRow
                icon={Clock}
                label={working.endHm ?? t.todos.endTime}
                active={panel === 'endTime'}
                side={side}
                width="w-64"
                flyoutLabel={t.todos.timePicker}
                onToggle={() => {
                  togglePanel('endTime');
                  setRangeFocus('end');
                  if (panel !== 'endTime' && working.endHm === null) {
                    edit({ ...working, endHm: '10:00' });
                  }
                }}
              >
                <TimePicker
                  value={working.endHm ?? '10:00'}
                  onChange={(hm) => edit(withEndHm(hm))}
                />
              </FlyoutRow>
            </>
          )}

          <FlyoutRow
            icon={AlarmClock}
            label={reminderLabel(working.reminder)}
            active={panel === 'remind'}
            side={side}
            flyoutLabel={t.todos.remind}
            onToggle={() => togglePanel('remind')}
          >
            <div className="flex flex-col gap-0.5">
              {(
                [
                  ['none', t.todos.reminderNone],
                  ['due', t.todos.reminderDue],
                  ...REMINDER_OFFSETS.map((minutes) => [String(minutes), offsetLabel(minutes)] as const),
                  ['custom', t.todos.reminderCustom],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`h-8 rounded-md px-2 text-left text-[length:var(--text-caption)] ${
                    working.reminder === value
                      ? 'bg-accent-subtle text-fg'
                      : 'text-muted hover:bg-surface-muted hover:text-fg'
                  }`}
                  onClick={() =>
                    edit({
                      ...working,
                      reminder: value as ReminderValue,
                      reminderAt:
                        value === 'custom'
                          ? (working.reminderAt ?? new Date().toISOString())
                          : working.reminderAt,
                    })
                  }
                >
                  {label}
                </button>
              ))}
              {working.reminder === 'custom' ? (
                <div className="pt-1">
                  <DateField
                    value={working.reminderAt ? toDatetimeLocal(working.reminderAt, zone) : ''}
                    kind="datetime-local"
                    ariaLabel={t.todos.reminderCustom}
                    zone={zone}
                    weekStartsOn={weekStartsOn}
                    onChange={(next) =>
                      edit({
                        ...working,
                        reminder: next === '' ? 'none' : 'custom',
                        reminderAt: next === '' ? null : fromDatetimeLocal(next, zone),
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          </FlyoutRow>

          <FlyoutRow
            icon={Repeat}
            label={recurrenceLabel(working.recurrenceKind)}
            active={panel === 'repeat'}
            side={side}
            flyoutLabel={t.todos.recurrence}
            onToggle={() => togglePanel('repeat')}
          >
            <div className="flex flex-col gap-0.5">
              {RECURRENCE.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`h-8 rounded-md px-2 text-left text-[length:var(--text-caption)] ${
                    (item.value === 'none'
                      ? working.recurrenceKind === null
                      : working.recurrenceKind === item.value)
                      ? 'bg-accent-subtle text-fg'
                      : 'text-muted hover:bg-surface-muted hover:text-fg'
                  }`}
                  onClick={() =>
                    edit({
                      ...working,
                      recurrenceKind: item.value === 'none' ? null : item.value,
                    })
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          </FlyoutRow>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="h-9 rounded-md bg-surface-muted text-[length:var(--text-meta)] text-muted hover:text-fg"
              onClick={clear}
            >
              {t.todos.clearSchedule}
            </button>
            <button
              type="button"
              className="h-9 rounded-md bg-accent text-[length:var(--text-meta)] text-on-accent hover:bg-accent-hover"
              onClick={() => popover.close()}
            >
              {t.todos.confirmSchedule}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-muted hover:text-fg"
    >
      {children}
    </button>
  );
}

function Row({
  icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Clock;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`mt-1 flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[length:var(--text-meta)] ${
        active ? 'bg-surface-muted text-fg' : 'text-fg hover:bg-surface-muted'
      }`}
    >
      <Icon icon={icon} size={15} className="text-accent" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-muted">›</span>
    </button>
  );
}

/** A row that opens its sub-panel as a side flyout menu instead of expanding inline. */
function FlyoutRow({
  icon,
  label,
  active,
  side,
  flyoutLabel,
  width = 'w-52',
  onToggle,
  children,
}: {
  icon: typeof Clock;
  label: string;
  active: boolean;
  side: FlySide;
  flyoutLabel: string;
  width?: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <Row icon={icon} label={label} active={active} onClick={onToggle} />
      {active ? (
        <div
          role="dialog"
          aria-label={flyoutLabel}
          className={`absolute top-0 z-[var(--z-dropdown)] ${width} ${FIELD_POPOVER_CLASS} p-2 ${
            side === 'right' ? 'left-full ml-2' : 'right-full mr-2'
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
