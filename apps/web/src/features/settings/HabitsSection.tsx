import type { CreateHabitInput, Habit, HabitKind, PatchHabitInput } from '@vital/dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { useHabitsQuery, todayKeys } from '@/features/today/queries';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { ACTIVITY_CARD } from './ActivitySectionHead';

const copy = t.settings.habits;

const BTN_GHOST_SM =
  'inline-flex h-[26px] items-center rounded-full px-2.5 text-[length:var(--text-caption)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60';
const BTN_PRIMARY_SM =
  'inline-flex h-[26px] items-center rounded-full bg-accent px-3 text-[length:var(--text-caption)] font-semibold text-on-accent transition-[color,background-color] duration-[var(--ease-out)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';

const STAT_NUM =
  'font-display text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] tabular-nums';
const STAT_LBL =
  'mt-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted';

interface HabitDraft {
  name: string;
  kind: HabitKind;
  targetCount: string;
  windowStart: string;
  windowEnd: string;
}

function draftFromHabit(habit: Habit): HabitDraft {
  return {
    name: habit.name,
    kind: habit.kind,
    targetCount: habit.targetCount === null ? '' : String(habit.targetCount),
    windowStart: habit.windowStart ?? '',
    windowEnd: habit.windowEnd ?? '',
  };
}

const EMPTY_DRAFT: HabitDraft = {
  name: '',
  kind: 'daily',
  targetCount: '8',
  windowStart: '',
  windowEnd: '',
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
  if (draft.kind === 'daily') return { ...base, kind: 'daily' };
  const targetCount = Number(draft.targetCount);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 99) return null;
  return { ...base, kind: 'count', targetCount };
}

function draftToPatch(draft: HabitDraft): PatchHabitInput | null {
  const name = draft.name.trim();
  if (name === '') return null;
  const patch: PatchHabitInput = {
    name,
    windowStart: draft.windowStart === '' ? null : draft.windowStart,
    windowEnd: draft.windowEnd === '' ? null : draft.windowEnd,
  };
  if (draft.kind === 'count') {
    const targetCount = Number(draft.targetCount);
    if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 99) return null;
    patch.targetCount = targetCount;
  }
  return patch;
}

/** Today progress for the ring and the hot chip: daily counts as done once todayDone > 0. */
function todayOf(habit: Habit): { done: number; total: number } {
  const total = Math.max(habit.todayTotal, 1);
  return { done: Math.min(habit.todayDone, total), total };
}

/** Chips under the name; the today chip turns hot once there is progress. */
function habitChips(habit: Habit): { text: string; hot: boolean }[] {
  const chips: { text: string; hot: boolean }[] = [
    {
      text:
        habit.kind === 'count'
          ? copy.countChip.replace('{n}', String(habit.targetCount ?? 0))
          : copy.dailyChip,
      hot: false,
    },
  ];
  if (habit.windowStart && habit.windowEnd) {
    chips.push({ text: `${habit.windowStart}–${habit.windowEnd}`, hot: false });
  }
  if (habit.active) {
    const { done, total } = todayOf(habit);
    if (habit.kind === 'count') {
      chips.push({
        text: copy.todayProgress.replace('{done}', String(done)).replace('{total}', String(total)),
        hot: done > 0,
      });
    } else {
      chips.push({
        text:
          habit.todayDone > 0
            ? copy.todayDone
            : copy.todayProgress.replace('{done}', String(done)).replace('{total}', String(total)),
        hot: habit.todayDone > 0,
      });
    }
  }
  return chips;
}

const RING_C = 2 * Math.PI * 17;

/** 40px progress ring: fills with today's completion, full + ✓ when done. */
function HabitRing({ habit }: { habit: Habit }) {
  const { done, total } = todayOf(habit);
  const active = habit.active;
  const progress = active ? done / total : 0;
  const complete = active && done >= total;
  return (
    <span className="relative h-10 w-10 shrink-0" aria-hidden="true">
      <svg viewBox="0 0 40 40" className="h-10 w-10 -rotate-90">
        <circle cx="20" cy="20" r="17" fill="none" strokeWidth="3.5" className="stroke-surface-muted" />
        <circle
          cx="20"
          cy="20"
          r="17"
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - progress)}
          className={complete ? 'stroke-done' : 'stroke-accent'}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums ${
          complete ? 'text-done' : 'text-muted'
        }`}
      >
        {complete ? '✓' : active ? `${done}/${total}` : '0'}
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
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--ease-out)] disabled:opacity-50 ${
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

/** Kind selector: segmented chips when editable (add form), readonly chip when editing. */
function KindField({
  draft,
  onChange,
  kindEditable,
}: {
  draft: HabitDraft;
  onChange: (next: HabitDraft) => void;
  kindEditable: boolean;
}) {
  if (!kindEditable) {
    return (
      <span className="inline-flex h-7 items-center rounded-full bg-elevated px-2.5 text-[length:var(--text-caption)] text-muted">
        {draft.kind === 'count' ? copy.kindCount : copy.kindDaily}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5" role="group" aria-label={copy.kind}>
      <span className="mr-1 text-[length:var(--text-caption)] text-muted">{copy.kind}</span>
      {(['daily', 'count'] as const).map((kind) => {
        const active = draft.kind === kind;
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange({ ...draft, kind, targetCount: kind === 'count' ? draft.targetCount || '8' : '' })
            }
            className={`h-7 rounded-full border px-3 text-[length:var(--text-caption)] font-medium transition-[color,background-color,border-color] duration-[var(--ease-out)] ${
              active
                ? 'border-accent bg-accent-subtle font-semibold text-accent'
                : 'border-border text-muted hover:bg-surface-muted hover:text-fg'
            }`}
          >
            {kind === 'count' ? copy.kindCount : copy.kindDaily}
          </button>
        );
      })}
    </span>
  );
}

function TargetField({
  draft,
  onChange,
}: {
  draft: HabitDraft;
  onChange: (next: HabitDraft) => void;
}) {
  if (draft.kind !== 'count') return null;
  return (
    <span className="flex items-center gap-1.5">
      <input
        aria-label={copy.target}
        inputMode="numeric"
        maxLength={2}
        value={draft.targetCount}
        onChange={(event) =>
          onChange({ ...draft, targetCount: event.target.value.replaceAll(/[^0-9]/g, '') })
        }
        className={`${FIELD_CONTROL_CLASS} h-9 w-14 px-2 text-center font-mono`}
      />
      <span className="text-[length:var(--text-caption)] text-tertiary">{copy.perDay}</span>
    </span>
  );
}

function WindowField({
  draft,
  onChange,
}: {
  draft: HabitDraft;
  onChange: (next: HabitDraft) => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5" aria-label={copy.window}>
      <span className="mr-1 text-[length:var(--text-caption)] text-muted">{copy.window}</span>
      <input
        type="time"
        aria-label={copy.window}
        value={draft.windowStart}
        onChange={(event) => onChange({ ...draft, windowStart: event.target.value })}
        className={`${FIELD_CONTROL_CLASS} h-9 w-auto px-2 font-mono`}
      />
      <span className="text-[length:var(--text-caption)] text-tertiary">–</span>
      <input
        type="time"
        aria-label={copy.window}
        value={draft.windowEnd}
        onChange={(event) => onChange({ ...draft, windowEnd: event.target.value })}
        className={`${FIELD_CONTROL_CLASS} h-9 w-auto px-2 font-mono`}
      />
    </span>
  );
}

function AddHabitForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<HabitDraft>(EMPTY_DRAFT);
  const create = useMutation({
    mutationFn: (input: CreateHabitInput) => client.createHabit(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: todayKeys.all });
      onDone();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = draftToInput(draft);
    if (!input) return;
    create.mutate(input);
  }

  return (
    <form
      data-region="habit-add"
      onSubmit={submit}
      className={`${ACTIVITY_CARD} flex flex-col gap-3 px-5 py-4`}
    >
      <input
        aria-label={copy.name}
        placeholder={copy.namePlaceholder}
        maxLength={120}
        value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        className={`${FIELD_CONTROL_CLASS} h-9 w-full`}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <KindField draft={draft} onChange={setDraft} kindEditable />
        <TargetField draft={draft} onChange={setDraft} />
      </div>
      <WindowField draft={draft} onChange={setDraft} />
      <span className="flex gap-2">
        <button
          type="submit"
          disabled={create.isPending || draftToInput(draft) === null}
          className={BTN_PRIMARY_SM}
        >
          {copy.submit}
        </button>
        <button type="button" onClick={onDone} className={BTN_GHOST_SM}>
          {copy.cancel}
        </button>
      </span>
    </form>
  );
}

function HabitRow({ habit }: { habit: Habit }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<HabitDraft>(() => draftFromHabit(habit));

  const invalidate = () => qc.invalidateQueries({ queryKey: todayKeys.all });
  const patch = useMutation({
    mutationFn: (input: PatchHabitInput) => client.patchHabit(habit.id, input),
    onSuccess: () => {
      setEditing(false);
      void invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: () => client.deleteHabit(habit.id),
    onSuccess: () => void invalidate(),
  });

  if (editing) {
    return (
      <li data-habit-row={habit.id} className="px-3 py-2">
        <form
          className="flex flex-col gap-3 rounded-xl bg-surface-muted px-4 py-3.5"
          onSubmit={(event) => {
            event.preventDefault();
            const input = draftToPatch(draft);
            if (input) patch.mutate(input);
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={copy.name}
              placeholder={copy.namePlaceholder}
              maxLength={120}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className={`${FIELD_CONTROL_CLASS} h-9 min-w-36 flex-1 bg-elevated`}
            />
            <KindField draft={draft} onChange={setDraft} kindEditable={false} />
            <TargetField draft={draft} onChange={setDraft} />
          </div>
          <WindowField draft={draft} onChange={setDraft} />
          <span className="flex gap-2">
            <button
              type="submit"
              disabled={patch.isPending || draftToPatch(draft) === null}
              className={BTN_PRIMARY_SM}
            >
              {copy.save}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(draftFromHabit(habit));
                setEditing(false);
              }}
              className={BTN_GHOST_SM}
            >
              {copy.cancel}
            </button>
          </span>
        </form>
      </li>
    );
  }

  return (
    <li
      data-habit-row={habit.id}
      data-habit-active={habit.active ? 'true' : 'false'}
      className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border px-5 py-3.5 last:border-b-0 ${
        habit.active ? '' : 'opacity-50'
      }`}
    >
      <HabitRing habit={habit} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[length:var(--text-body)] font-semibold text-fg">
          <span className="truncate">{habit.name}</span>
          {habit.createdBy === 'agent' ? (
            <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-accent-subtle px-2 text-[11px] font-semibold text-accent">
              {copy.agentBadge}
            </span>
          ) : null}
          {!habit.active ? (
            <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-surface-muted px-2 text-[11px] text-tertiary">
              {copy.inactive}
            </span>
          ) : null}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {habitChips(habit).map((chip) => (
            <span
              key={chip.text}
              className={`inline-flex h-5 items-center rounded-full px-2 font-mono text-[11px] tabular-nums ${
                chip.hot ? 'bg-accent-subtle font-semibold text-accent' : 'bg-surface-muted text-muted'
              }`}
            >
              {chip.text}
            </span>
          ))}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => setEditing(true)} className={BTN_GHOST_SM}>
          {copy.edit}
        </button>
        <ActiveSwitch
          active={habit.active}
          disabled={patch.isPending}
          onToggle={() => patch.mutate({ active: !habit.active })}
        />
        {confirming ? (
          <>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              className={`${BTN_GHOST_SM} text-danger hover:text-danger`}
            >
              {copy.confirmDelete}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={BTN_GHOST_SM}>
              {copy.cancel}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={`${BTN_GHOST_SM} hover:text-danger`}
          >
            {copy.del}
          </button>
        )}
      </span>
    </li>
  );
}

export function HabitsSection({
  adding,
  onDoneAdding,
}: {
  adding: boolean;
  onDoneAdding: () => void;
}) {
  const query = useHabitsQuery();

  if (query.isPending) {
    return (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">…</p>
    );
  }

  const habits = query.data ?? [];
  const active = habits.filter((habit) => habit.active);
  const todayDone = active.reduce((sum, habit) => sum + todayOf(habit).done, 0);
  const todayTotal = active.reduce((sum, habit) => sum + todayOf(habit).total, 0);

  return (
    <div className="flex flex-col gap-7" data-region="habits-manage">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {habits.length}
            <span className="ml-1 text-[length:var(--text-meta)] font-medium text-tertiary">
              {copy.stats.unit}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.stats.total}</p>
        </div>
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {active.length}
            <span className="ml-1 text-[length:var(--text-meta)] font-medium text-tertiary">
              {copy.stats.unit}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.stats.active}</p>
        </div>
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {todayDone}
            <span className="ml-1 text-[length:var(--text-meta)] font-medium text-tertiary">
              / {todayTotal}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.stats.todayDone}</p>
        </div>
      </div>

      {adding ? <AddHabitForm onDone={onDoneAdding} /> : null}

      {habits.length === 0 ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {copy.empty}
        </p>
      ) : (
        <div className={ACTIVITY_CARD}>
          <ul className="flex flex-col">
            {habits.map((habit) => (
              <HabitRow key={habit.id} habit={habit} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
