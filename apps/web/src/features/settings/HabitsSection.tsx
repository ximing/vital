import type {
  CreateHabitInput,
  Habit,
  HabitCheckin,
  HabitCheckinDay,
  HabitKind,
  Outcome,
  PatchHabitInput,
} from '@vital/dto';
import { useService } from '@rabjs/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Flame, Minus, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { client } from '@/api/client';
import { t } from '@/copy';
import { habitTodayProgress, todayKeys, useHabitsQuery, useOutcomesQuery } from '@/features/today';
import { formatYmd, todayYmd } from '@/features/todos/model';
import { addDaysYmd, padYmd, ymdParts } from '@/lib/calendar-grid';
import { AuthService } from '@/services/auth.service';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { EmptyArt } from '@/ui/empty-art';
import { OutcomeField } from '@/ui/outcome-field';
import { Overlay } from '@/ui/overlay';
import { HabitCheckinCalendar } from './HabitCheckinCalendar';
import { HabitMonthNav } from './HabitMonthNav';

const copy = t.settings.habits;

const BTN_GHOST_SM =
  'inline-flex h-[26px] items-center rounded-full px-2.5 text-[length:var(--text-caption)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60';
const BTN_PRIMARY_SM =
  'inline-flex h-[26px] items-center rounded-full bg-accent px-3 text-[length:var(--text-caption)] font-semibold text-on-accent transition-[color,background-color] duration-[var(--ease-out)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';

interface HabitDraft {
  name: string;
  kind: HabitKind;
  targetCount: string;
  windowStart: string;
  windowEnd: string;
  outcomeId: string | null;
}

function draftFromHabit(habit: Habit): HabitDraft {
  return {
    name: habit.name,
    kind: habit.kind,
    targetCount: habit.targetCount === null ? '' : String(habit.targetCount),
    windowStart: habit.windowStart ?? '',
    windowEnd: habit.windowEnd ?? '',
    outcomeId: habit.outcomeId,
  };
}

const EMPTY_DRAFT: HabitDraft = {
  name: '',
  kind: 'daily',
  targetCount: '8',
  windowStart: '',
  windowEnd: '',
  outcomeId: null,
};

/** Validated draft → API input; null when invalid. */
function draftToInput(draft: HabitDraft): CreateHabitInput | null {
  const name = draft.name.trim();
  if (name === '') return null;
  const base = {
    name,
    windowStart: draft.windowStart === '' ? undefined : draft.windowStart,
    windowEnd: draft.windowEnd === '' ? undefined : draft.windowEnd,
  };
  const withThread = draft.outcomeId ? { ...base, outcomeId: draft.outcomeId } : base;
  if (draft.kind === 'daily') return { ...withThread, kind: 'daily' };
  const targetCount = Number(draft.targetCount);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 99) return null;
  return { ...withThread, kind: 'count', targetCount };
}

function draftToPatch(draft: HabitDraft): PatchHabitInput | null {
  const name = draft.name.trim();
  if (name === '') return null;
  const patch: PatchHabitInput = {
    name,
    windowStart: draft.windowStart === '' ? null : draft.windowStart,
    windowEnd: draft.windowEnd === '' ? null : draft.windowEnd,
    outcomeId: draft.outcomeId,
  };
  if (draft.kind === 'count') {
    const targetCount = Number(draft.targetCount);
    if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 99) return null;
    patch.targetCount = targetCount;
  }
  return patch;
}

function todayOf(habit: Habit): { done: number; total: number; complete: boolean } {
  return habitTodayProgress(habit);
}

/* ===== derived stats (checkin days → streak / rates) ===== */

type DayMap = Map<string, number>;

function dayMap(days: HabitCheckinDay[]): DayMap {
  return new Map(days.map((row) => [row.date, row.done]));
}

/** Consecutive 达标 days ending today; an incomplete today does not break the run. */
function streakOf(days: DayMap, total: number, createdOn: string, today: string): number {
  let cursor = (days.get(today) ?? 0) >= total ? today : addDaysYmd(today, -1);
  let streak = 0;
  while (cursor >= createdOn && (days.get(cursor) ?? 0) >= total) {
    streak += 1;
    cursor = addDaysYmd(cursor, -1);
  }
  return streak;
}

function weekStartYmd(today: string, weekStartsOn: 0 | 1): string {
  const { y, m, d } = ymdParts(today);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysYmd(today, -((dow - weekStartsOn + 7) % 7));
}

/** hit/eligible habit-days within [from, to]; days before creation don't count. */
function hitDays(
  days: DayMap,
  total: number,
  from: string,
  to: string,
): { hit: number; eligible: number } {
  let hit = 0;
  let eligible = 0;
  let cursor = from;
  while (cursor <= to) {
    eligible += 1;
    if ((days.get(cursor) ?? 0) >= total) hit += 1;
    cursor = addDaysYmd(cursor, 1);
  }
  return { hit, eligible };
}

/* ===== overview bar ===== */

const OV_C = 2 * Math.PI * 33;

function OverviewRing({ done, total }: { done: number; total: number }) {
  const progress = total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <span className="relative inline-flex h-[76px] w-[76px] shrink-0" aria-hidden="true">
      <svg viewBox="0 0 76 76" className="h-[76px] w-[76px] -rotate-90">
        <circle cx="38" cy="38" r="33" fill="none" strokeWidth="7" className="stroke-surface-muted" />
        {progress > 0 ? (
          <circle
            cx="38"
            cy="38"
            r="33"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={OV_C}
            strokeDashoffset={OV_C * (1 - progress)}
            className="stroke-accent"
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <b className="font-display text-[19px] font-bold leading-none text-accent-deep tabular-nums">
          {done}/{total}
        </b>
        <span className="mt-1 text-[10px] leading-none text-tertiary">{copy.ov.today}</span>
      </span>
    </span>
  );
}

function OvStat({
  value,
  unit,
  label,
  hot = false,
}: {
  value: string;
  unit?: string;
  label: string;
  hot?: boolean;
}) {
  return (
    <span className="border-l border-border pl-6 text-right first:border-l-0 first:pl-0">
      <span
        className={`block font-display text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] tabular-nums ${hot ? 'text-accent-deep' : 'text-fg'}`}
      >
        {value}
        {unit ? (
          <span className="ml-0.5 text-[length:var(--text-caption)] font-medium text-tertiary">
            {unit}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block text-[11px] text-tertiary">{label}</span>
    </span>
  );
}

function OverviewBar({
  habits,
  statsItems,
  zone,
  weekStartsOn,
  today,
}: {
  habits: Habit[];
  statsItems: HabitCheckin[] | undefined;
  zone: string;
  weekStartsOn: 0 | 1;
  today: string;
}) {
  const active = habits.filter((habit) => habit.active);
  const todayDone = active.reduce((sum, habit) => sum + todayOf(habit).done, 0);
  const todayTotal = active.reduce((sum, habit) => sum + todayOf(habit).total, 0);
  const remaining = active.reduce(
    (sum, habit) => sum + Math.max(0, todayOf(habit).total - todayOf(habit).done),
    0,
  );

  const title =
    todayTotal === 0
      ? copy.ov.titleNone
      : remaining === 0
        ? copy.ov.titleAll
        : todayDone > 0
          ? copy.ov.titleSome
          : copy.ov.titleNone;
  const sub =
    todayTotal === 0
      ? copy.ov.noActive
      : remaining === 0
        ? copy.ov.remainAll
        : copy.ov.remain.replace('{n}', String(remaining));

  const byHabit = new Map((statsItems ?? []).map((row) => [row.habitId, dayMap(row.days)]));
  const weekStart = weekStartYmd(today, weekStartsOn);
  let weekHit = 0;
  let weekEligible = 0;
  for (const habit of active) {
    const createdOn = formatYmd(new Date(habit.createdAt), zone);
    const from = createdOn > weekStart ? createdOn : weekStart;
    if (from > today) continue;
    const { hit, eligible } = hitDays(
      byHabit.get(habit.id) ?? new Map(),
      todayOf(habit).total,
      from,
      today,
    );
    weekHit += hit;
    weekEligible += eligible;
  }
  const weekRate = weekEligible > 0 ? Math.round((100 * weekHit) / weekEligible) : null;
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthCount = (statsItems ?? []).reduce(
    (sum, row) =>
      sum + row.days.reduce((acc, day) => (day.date >= monthStart ? acc + day.done : acc), 0),
    0,
  );

  return (
    <div className="relative flex flex-wrap items-center gap-x-7 gap-y-4 overflow-hidden rounded-[20px] bg-elevated px-7 py-5 shadow-[var(--shadow)]">
      <span className="absolute bottom-0 left-0 top-0 w-1 bg-accent" aria-hidden="true" />
      <OverviewRing done={todayDone} total={todayTotal} />
      <div className="min-w-0">
        <p className="font-display text-[length:var(--text-section)] font-semibold leading-[var(--text-section-lh)]">
          {title}
        </p>
        <p className="mt-1 max-w-md text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {sub}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-6">
        <OvStat value={String(active.length)} unit={copy.stats.unit} label={copy.stats.active} hot />
        <OvStat value={weekRate === null ? '—' : `${weekRate}%`} label={copy.ov.weekRate} />
        <OvStat value={String(monthCount)} unit={copy.ov.unitTimes} label={copy.ov.monthCount} />
      </div>
    </div>
  );
}

/* ===== card ring ===== */

const CARD_C = 2 * Math.PI * 15.5;

function CardRing({ habit }: { habit: Habit }) {
  const { done, total, complete } = todayOf(habit);
  if (!habit.active) {
    return (
      <span
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-surface-muted text-[13px] text-tertiary"
        aria-hidden="true"
      >
        –
      </span>
    );
  }
  if (complete) {
    return (
      <span
        className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-done"
        aria-hidden="true"
      >
        <Icon icon={Check} size={15} className="text-on-accent" />
      </span>
    );
  }
  const progress = total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <span className="relative inline-flex h-[38px] w-[38px] shrink-0" aria-hidden="true">
      <svg viewBox="0 0 38 38" className="h-[38px] w-[38px] -rotate-90">
        <circle cx="19" cy="19" r="15.5" fill="none" strokeWidth="4" className="stroke-surface-muted" />
        {progress > 0 ? (
          <circle
            cx="19"
            cy="19"
            r="15.5"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={CARD_C}
            strokeDashoffset={CARD_C * (1 - progress)}
            className="stroke-accent"
          />
        ) : null}
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums ${done > 0 ? 'text-accent-deep' : 'text-tertiary'}`}
      >
        {habit.kind === 'count' ? `${done}/${total}` : done}
      </span>
    </span>
  );
}

function ActiveSwitch({
  active,
  disabled,
  onToggle,
}: {
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={copy.enableAria}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-[color,background-color,opacity] duration-[var(--ease-out)] disabled:opacity-50 group-hover:pointer-events-none group-hover:opacity-0 ${
        active ? 'bg-accent' : 'bg-surface-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-elevated shadow-[var(--shadow-xs)] transition-[left] duration-[var(--ease-out)] ${
          active ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

/* ===== habit card ===== */

function monthRange(monthCursor: string): { from: string; to: string } {
  const { y, m } = ymdParts(monthCursor);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: padYmd(y, m, 1), to: padYmd(y, m, last) };
}

function checkinsFor(items: HabitCheckin[] | undefined, habitId: string) {
  return items?.find((row) => row.habitId === habitId)?.days ?? [];
}

function HabitCard({
  habit,
  outcomes,
  days,
  statsDays,
  monthCursor,
  weekStartsOn,
  today,
  createdOn,
  onEdit,
}: {
  habit: Habit;
  outcomes: Outcome[];
  days: HabitCheckin['days'];
  statsDays: HabitCheckin['days'];
  monthCursor: string;
  weekStartsOn: 0 | 1;
  today: string;
  createdOn: string;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: todayKeys.all });
  const patch = useMutation({
    mutationFn: (input: PatchHabitInput) => client.patchHabit(habit.id, input),
    onSuccess: () => void invalidate(),
  });
  const remove = useMutation({
    mutationFn: () => client.deleteHabit(habit.id),
    onSuccess: () => void invalidate(),
  });

  const { done, total, complete } = todayOf(habit);
  const thread = outcomes.find((outcome) => outcome.id === habit.outcomeId);
  const subParts: { text: string; tone: 'plain' | 'hot' | 'thread' }[] = [
    {
      text:
        habit.kind === 'count'
          ? copy.countChip.replace('{n}', String(habit.targetCount ?? 0))
          : copy.dailyChip,
      tone: 'plain',
    },
  ];
  if (habit.windowStart && habit.windowEnd) {
    subParts.push({ text: `${habit.windowStart}–${habit.windowEnd}`, tone: 'plain' });
  }
  if (thread) subParts.push({ text: thread.name, tone: 'thread' });
  if (habit.active) {
    subParts.push({
      text: complete
        ? copy.todayDone
        : done > 0
          ? copy.todayProgress.replace('{done}', String(done)).replace('{total}', String(total))
          : copy.todayNone,
      tone: 'hot',
    });
  }

  // footer: streak is "now" (trailing range); month hit/eligible follows the visible month
  const streak = streakOf(dayMap(statsDays), total, createdOn, today);
  const { m } = ymdParts(monthCursor);
  const range = monthRange(monthCursor);
  const monthFrom = createdOn > range.from ? createdOn : range.from;
  const monthTo = range.to < today ? range.to : today;
  const { hit, eligible } =
    monthFrom > monthTo ? { hit: 0, eligible: 0 } : hitDays(dayMap(days), total, monthFrom, monthTo);

  return (
    <div
      data-habit-row={habit.id}
      data-habit-active={habit.active ? 'true' : 'false'}
      className={`group relative rounded-2xl border px-5 pb-3 pt-4 transition-[box-shadow,border-color,background-color] duration-[var(--ease-out)] ${
        habit.active
          ? 'border-border bg-surface hover:border-transparent hover:bg-elevated hover:shadow-[var(--shadow)]'
          : 'border-dashed border-border bg-transparent hover:bg-surface'
      }`}
    >
      <span className="absolute right-4 top-3.5 flex gap-0.5 opacity-0 transition-opacity duration-[var(--ease-out)] group-hover:opacity-100">
        <button type="button" onClick={onEdit} className={BTN_GHOST_SM}>
          {copy.edit}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${BTN_GHOST_SM} hover:text-danger`}
        >
          {copy.del}
        </button>
      </span>

      <div className={habit.active ? '' : 'opacity-50'}>
        <div className="flex items-center gap-3">
          <CardRing habit={habit} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[length:var(--text-body)] font-semibold text-fg">
              <span className="truncate">{habit.name}</span>
              {habit.createdBy === 'agent' ? (
                <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-accent-subtle px-[7px] text-[10px] font-semibold text-accent-deep">
                  {copy.agentBadge}
                </span>
              ) : null}
              {!habit.active ? (
                <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-surface-muted px-[7px] text-[10px] text-tertiary">
                  {copy.inactive}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[length:var(--text-caption)] text-muted">
              {subParts.map((part, index) => (
                <span key={index} className="flex items-center gap-1.5">
                  {index > 0 ? <span className="h-[3px] w-[3px] rounded-full bg-tertiary" /> : null}
                  <span
                    className={`truncate tabular-nums ${
                      part.tone === 'hot' && (done > 0 || complete)
                        ? 'font-semibold text-accent'
                        : part.tone === 'thread'
                          ? 'text-accent-deep'
                          : ''
                    }`}
                  >
                    {part.text}
                  </span>
                </span>
              ))}
            </p>
          </div>
          <ActiveSwitch
            active={habit.active}
            disabled={patch.isPending}
            onToggle={() => patch.mutate({ active: !habit.active })}
          />
        </div>

        {confirming ? (
          <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-danger/25 bg-danger/5 px-3 py-2">
            <p className="min-w-0 flex-1 text-[length:var(--text-caption)] font-medium text-danger">
              {copy.deleteConfirmBody.replace('{name}', habit.name)}
            </p>
            <button type="button" onClick={() => setConfirming(false)} className={BTN_GHOST_SM}>
              {copy.cancel}
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="inline-flex h-[26px] shrink-0 items-center rounded-full bg-danger px-3 text-[length:var(--text-caption)] font-semibold text-on-accent transition-opacity duration-[var(--ease-out)] hover:opacity-90 disabled:opacity-60"
            >
              {copy.confirmDelete}
            </button>
          </div>
        ) : (
          <>
            <HabitCheckinCalendar
              habit={habit}
              days={days}
              monthCursor={monthCursor}
              weekStartsOn={weekStartsOn}
              today={today}
              createdOn={createdOn}
              paused={!habit.active}
            />
            <p className="mt-2 flex items-center gap-1.5 border-t border-dashed border-border pt-2.5 text-[11px] text-tertiary">
              {habit.active ? (
                streak >= 2 ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-due">
                    <Icon icon={Flame} size={12} />
                    {copy.streak.replace('{n}', String(streak))}
                  </span>
                ) : (
                  <span>{copy.monthHit.replace('{m}', String(m)).replace('{n}', String(hit))}</span>
                )
              ) : (
                <span>{copy.pausedNote}</span>
              )}
              {habit.active ? (
                <span className="ml-auto tabular-nums">
                  {copy.monthDays
                    .replace('{m}', String(m))
                    .replace('{hit}', String(hit))
                    .replace('{days}', String(eligible))}
                </span>
              ) : null}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ===== add / edit dialog ===== */

function FieldLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <span className="mb-1.5 block text-[length:var(--text-caption)] font-semibold text-muted">
      {children}
      {hint ? <span className="ml-1 font-normal text-tertiary">（{hint}）</span> : null}
    </span>
  );
}

function TargetStepper({
  draft,
  onChange,
}: {
  draft: HabitDraft;
  onChange: (next: HabitDraft) => void;
}) {
  const value = Number(draft.targetCount) || 0;
  const setValue = (next: number) =>
    onChange({ ...draft, targetCount: String(Math.min(99, Math.max(1, next))) });
  const STEP_BTN =
    'inline-flex h-9 w-8 items-center justify-center text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg';
  return (
    <span className="flex items-center">
      <span className="inline-flex h-9 items-center overflow-hidden rounded-[10px] border border-border bg-surface">
        <button type="button" aria-label="−" className={STEP_BTN} onClick={() => setValue(value - 1)}>
          <Icon icon={Minus} size={13} />
        </button>
        <input
          aria-label={copy.target}
          inputMode="numeric"
          maxLength={2}
          value={draft.targetCount}
          onChange={(event) =>
            onChange({ ...draft, targetCount: event.target.value.replaceAll(/[^0-9]/g, '') })
          }
          className="h-full w-11 border-0 bg-transparent text-center text-[length:var(--text-body)] font-semibold tabular-nums text-fg outline-none"
        />
        <button type="button" aria-label="+" className={STEP_BTN} onClick={() => setValue(value + 1)}>
          <Icon icon={Plus} size={13} />
        </button>
      </span>
      <span className="ml-2 whitespace-nowrap text-[length:var(--text-caption)] text-tertiary">
        {copy.perDaySuffix}
      </span>
    </span>
  );
}

function HabitDialog({
  habit,
  outcomes,
  zone,
  onClose,
}: {
  habit: Habit | null;
  outcomes: Outcome[];
  zone: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isNew = habit === null;
  const [draft, setDraft] = useState<HabitDraft>(() =>
    habit ? draftFromHabit(habit) : EMPTY_DRAFT,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: todayKeys.all });
  const create = useMutation({
    mutationFn: (input: CreateHabitInput) => client.createHabit(input),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const patch = useMutation({
    mutationFn: (input: PatchHabitInput) => client.patchHabit(habit?.id ?? '', input),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => client.deleteHabit(habit?.id ?? ''),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (isNew) {
      const input = draftToInput(draft);
      if (input) create.mutate(input);
    } else {
      const input = draftToPatch(draft);
      if (input) patch.mutate(input);
    }
  }

  const valid = isNew ? draftToInput(draft) !== null : draftToPatch(draft) !== null;
  const pending = create.isPending || patch.isPending;

  return createPortal(
    <Overlay tone="scrim" align="center" className="px-4" onClose={onClose} closeOnEscape lockFocus restoreFocus>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? copy.dialogNew : copy.dialogEdit}
        data-region={isNew ? 'habit-add' : 'habit-edit'}
        onSubmit={submit}
        className="flex w-full max-w-[480px] flex-col rounded-[20px] border border-border bg-elevated px-7 pb-5 pt-6 shadow-[var(--shadow)]"
      >
        <h2 className="font-display text-[length:var(--text-section)] font-bold leading-[var(--text-section-lh)]">
          {isNew ? copy.dialogNew : copy.dialogEdit}
        </h2>
        <p className="mt-0.5 text-[length:var(--text-caption)] text-tertiary">{copy.dialogHint}</p>

        <label className="mt-4 block">
          <FieldLabel>{copy.name}</FieldLabel>
          <input
            aria-label={copy.name}
            placeholder={copy.namePlaceholder}
            maxLength={120}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            className={`${FIELD_CONTROL_CLASS} h-[38px] w-full`}
          />
        </label>

        <div className="mt-4">
          <FieldLabel>{copy.kind}</FieldLabel>
          <div className="flex flex-wrap items-center gap-4">
            {isNew ? (
              <span
                className="inline-flex gap-0.5 rounded-[10px] bg-surface-muted p-[3px]"
                role="group"
                aria-label={copy.kind}
              >
                {(['daily', 'count'] as const).map((kind) => {
                  const active = draft.kind === kind;
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          kind,
                          targetCount: kind === 'count' ? draft.targetCount || '8' : '',
                        })
                      }
                      className={`h-[30px] rounded-lg px-3.5 text-[length:var(--text-meta)] transition-[color,background-color,box-shadow] duration-[var(--ease-out)] ${
                        active
                          ? 'bg-elevated font-semibold text-fg shadow-[var(--shadow-xs)]'
                          : 'text-muted hover:text-fg'
                      }`}
                    >
                      {kind === 'count' ? copy.kindCount : copy.kindDaily}
                    </button>
                  );
                })}
              </span>
            ) : (
              <span className="inline-flex h-[30px] items-center rounded-full bg-surface-muted px-3 text-[length:var(--text-caption)] text-muted">
                {draft.kind === 'count' ? copy.kindCount : copy.kindDaily}
              </span>
            )}
            {draft.kind === 'count' ? <TargetStepper draft={draft} onChange={setDraft} /> : null}
          </div>
        </div>

        <div className="mt-4">
          <FieldLabel hint={copy.windowHint}>{copy.window}</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              type="time"
              aria-label={copy.window}
              value={draft.windowStart}
              onChange={(event) => setDraft({ ...draft, windowStart: event.target.value })}
              className={`${FIELD_CONTROL_CLASS} h-[38px] w-[110px] px-2.5 font-mono`}
            />
            <span className="text-tertiary">–</span>
            <input
              type="time"
              aria-label={copy.window}
              value={draft.windowEnd}
              onChange={(event) => setDraft({ ...draft, windowEnd: event.target.value })}
              className={`${FIELD_CONTROL_CLASS} h-[38px] w-[110px] px-2.5 font-mono`}
            />
            <span className="text-[11px] text-tertiary">{zone}</span>
          </div>
        </div>

        <div className="mt-4">
          <FieldLabel hint={copy.optional}>{copy.thread}</FieldLabel>
          <OutcomeField
            value={draft.outcomeId}
            outcomes={outcomes}
            placeholder={copy.thread}
            onChange={(outcomeId) => setDraft({ ...draft, outcomeId })}
          />
        </div>

        {confirmingDelete ? (
          <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
            <p className="min-w-0 flex-1 text-[length:var(--text-caption)] font-medium text-danger">
              {copy.deleteConfirmBody.replace('{name}', habit?.name ?? '')}
            </p>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className={BTN_GHOST_SM}
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className="inline-flex h-[30px] shrink-0 items-center rounded-full bg-danger px-3.5 text-[length:var(--text-caption)] font-semibold text-on-accent transition-opacity duration-[var(--ease-out)] hover:opacity-90 disabled:opacity-60"
            >
              {copy.confirmDelete}
            </button>
          </div>
        ) : (
          <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
            {isNew ? null : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className={`${BTN_GHOST_SM} h-[30px] text-danger hover:text-danger`}
              >
                {copy.del}
              </button>
            )}
            <span className="flex-1" />
            <button type="button" onClick={onClose} className={`${BTN_GHOST_SM} h-[30px] px-3.5`}>
              {copy.cancel}
            </button>
            <button
              type="submit"
              disabled={pending || !valid}
              className="inline-flex h-[30px] items-center rounded-full bg-accent px-4 text-[length:var(--text-caption)] font-semibold text-on-accent transition-[color,background-color] duration-[var(--ease-out)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isNew ? copy.submit : copy.save}
            </button>
          </div>
        )}
      </form>
    </Overlay>,
    document.body,
  );
}

/* ===== empty state ===== */

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-surface px-8 py-11 text-center">
      <EmptyArt className="mb-0" />
      <p className="mt-4 font-display text-[length:var(--text-section)] font-semibold">
        {copy.emptyTitle}
      </p>
      <p className="mt-1 max-w-sm text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {copy.emptyBody}
      </p>
      <button type="button" onClick={onAdd} className={`${BTN_PRIMARY_SM} mt-4 h-[32px] px-4`}>
        ＋ {copy.emptyCta}
      </button>
    </div>
  );
}

/* ===== section ===== */

type Filter = 'all' | 'active' | 'paused';

export function HabitsSection({
  adding,
  onStartAdding,
  onDoneAdding,
}: {
  adding: boolean;
  onStartAdding: () => void;
  onDoneAdding: () => void;
}) {
  const query = useHabitsQuery();
  const outcomesQuery = useOutcomesQuery();
  const auth = useService(AuthService);
  const zone = auth.user?.timezone ?? 'UTC';
  const weekStartsOn = auth.user?.weekStartsOn === 0 ? 0 : 1;
  const today = todayYmd(zone);
  const [monthCursor, setMonthCursor] = useState(`${today.slice(0, 7)}-01`);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Habit | null>(null);
  const range = monthRange(monthCursor);
  const checkinsQuery = useQuery({
    queryKey: todayKeys.habitCheckins(range.from, range.to),
    queryFn: () => client.listHabitCheckins(range),
  });
  // trailing 92 days: powers streaks and the overview bar, independent of the visible month
  const statsRange = { from: addDaysYmd(today, -92), to: today };
  const statsQuery = useQuery({
    queryKey: todayKeys.habitCheckins(statsRange.from, statsRange.to),
    queryFn: () => client.listHabitCheckins(statsRange),
  });

  if (query.isPending) {
    return (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">…</p>
    );
  }

  const habits = query.data ?? [];
  const activeCount = habits.filter((habit) => habit.active).length;
  const visible = habits.filter((habit) =>
    filter === 'all' ? true : filter === 'active' ? habit.active : !habit.active,
  );
  const checkins = checkinsQuery.data?.items;
  const statsItems = statsQuery.data?.items;

  const pills: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: copy.filters.all, count: habits.length },
    { id: 'active', label: copy.filters.active, count: activeCount },
    { id: 'paused', label: copy.filters.paused, count: habits.length - activeCount },
  ];

  return (
    <div className="flex flex-col gap-6" data-region="habits-manage">
      <OverviewBar
        habits={habits}
        statsItems={statsItems}
        zone={zone}
        weekStartsOn={weekStartsOn}
        today={today}
      />

      {habits.length === 0 ? (
        <EmptyState onAdd={onStartAdding} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {pills.map((pill) => (
              <button
                key={pill.id}
                type="button"
                aria-pressed={filter === pill.id}
                onClick={() => setFilter(pill.id)}
                className={`inline-flex h-8 items-center rounded-full px-3.5 text-[length:var(--text-meta)] transition-[color,background-color] duration-[var(--ease-out)] ${
                  filter === pill.id
                    ? 'bg-accent-subtle font-semibold text-accent-deep'
                    : 'text-muted hover:bg-surface-muted hover:text-fg'
                }`}
              >
                {pill.label} <span className="ml-1 tabular-nums">{pill.count}</span>
              </button>
            ))}
            <div className="ml-auto">
              <HabitMonthNav monthCursor={monthCursor} today={today} onChange={setMonthCursor} />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-[length:var(--text-meta)] text-tertiary">
              {copy.filterEmpty}
            </p>
          ) : (
            <div className="grid items-start gap-4 xl:grid-cols-2">
              {visible.map((habit) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  outcomes={outcomesQuery.data ?? []}
                  days={checkinsFor(checkins, habit.id)}
                  statsDays={checkinsFor(statsItems, habit.id)}
                  monthCursor={monthCursor}
                  weekStartsOn={weekStartsOn}
                  today={today}
                  createdOn={formatYmd(new Date(habit.createdAt), zone)}
                  onEdit={() => setEditing(habit)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {adding ? (
        <HabitDialog habit={null} outcomes={outcomesQuery.data ?? []} zone={zone} onClose={onDoneAdding} />
      ) : null}
      {editing ? (
        <HabitDialog
          habit={editing}
          outcomes={outcomesQuery.data ?? []}
          zone={zone}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
