import type { CreateHabitInput, Habit, HabitKind, Outcome, PatchHabitInput } from '@vital/dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { HabitRing } from '@/features/today/HabitRing';
import { habitTodayProgress } from '@/features/today/model';
import { useHabitsQuery, useOutcomesQuery, todayKeys } from '@/features/today/queries';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { OutcomeField } from '@/ui/outcome-field';
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

/** Chips under the name; the today chip turns hot once there is progress. */
function habitChips(habit: Habit, outcomes: Outcome[]): { text: string; hot: boolean }[] {
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
  const thread = outcomes.find((outcome) => outcome.id === habit.outcomeId);
  if (thread) chips.push({ text: thread.name, hot: false });
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

function HabitRowRing({ habit }: { habit: Habit }) {
  const { done, total, complete } = todayOf(habit);
  return (
    <HabitRing
      done={done}
      total={total}
      complete={habit.active && complete}
      paused={!habit.active}
    />
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

function AddHabitForm({ onDone, outcomes }: { onDone: () => void; outcomes: Outcome[] }) {
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
      <OutcomeField
        value={draft.outcomeId}
        outcomes={outcomes}
        placeholder={copy.thread}
        onChange={(outcomeId) => setDraft({ ...draft, outcomeId })}
      />
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

function HabitRow({ habit, outcomes }: { habit: Habit; outcomes: Outcome[] }) {
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
          <OutcomeField
            value={draft.outcomeId}
            outcomes={outcomes}
            placeholder={copy.thread}
            onChange={(outcomeId) => setDraft({ ...draft, outcomeId })}
          />
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
      <HabitRowRing habit={habit} />
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
          {habitChips(habit, outcomes).map((chip) => (
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
  const outcomesQuery = useOutcomesQuery();

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

      {adding ? (
        <AddHabitForm onDone={onDoneAdding} outcomes={outcomesQuery.data ?? []} />
      ) : null}

      {habits.length === 0 ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {copy.empty}
        </p>
      ) : (
        <div className={ACTIVITY_CARD}>
          <ul className="flex flex-col">
            {habits.map((habit) => (
              <HabitRow key={habit.id} habit={habit} outcomes={outcomesQuery.data ?? []} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
