import type { CreateHabitInput, Habit, HabitKind, PatchHabitInput } from '@vital/dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { client } from '@/api/client';
import { t } from '@/copy';
import { useHabitsQuery, todayKeys } from '@/features/today/queries';
import { FIELD_CONTROL_CLASS } from '@/ui/field';

const copy = t.settings.habits;

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

function habitMeta(habit: Habit): string[] {
  const chips = [
    habit.kind === 'count'
      ? copy.countChip.replace('{n}', String(habit.targetCount ?? 0))
      : copy.dailyChip,
  ];
  if (habit.windowStart && habit.windowEnd) chips.push(`${habit.windowStart}–${habit.windowEnd}`);
  if (habit.active) {
    chips.push(
      habit.kind === 'count'
        ? copy.todayProgress
            .replace('{done}', String(habit.todayDone))
            .replace('{total}', String(habit.todayTotal))
        : habit.todayDone > 0
          ? copy.todayDone
          : copy.todayProgress
              .replace('{done}', String(habit.todayDone))
              .replace('{total}', String(Math.max(habit.todayTotal, 1))),
    );
  }
  return chips;
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

function HabitFields({
  draft,
  onChange,
  kindEditable,
}: {
  draft: HabitDraft;
  onChange: (next: HabitDraft) => void;
  kindEditable: boolean;
}) {
  return (
    <>
      <input
        aria-label={copy.name}
        placeholder={copy.namePlaceholder}
        maxLength={120}
        value={draft.name}
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
        className={`${FIELD_CONTROL_CLASS} h-9 min-w-36 flex-1`}
      />
      {kindEditable ? (
        <select
          aria-label={copy.kind}
          value={draft.kind}
          onChange={(event) => {
            const kind = event.target.value as HabitKind;
            onChange({ ...draft, kind, targetCount: kind === 'count' ? draft.targetCount || '8' : '' });
          }}
          className={`${FIELD_CONTROL_CLASS} h-9 w-auto py-0 pr-8`}
        >
          <option value="daily">{copy.kindDaily}</option>
          <option value="count">{copy.kindCount}</option>
        </select>
      ) : (
        <span className="inline-flex h-9 items-center rounded-md bg-surface-muted px-2.5 text-[length:var(--text-caption)] text-muted">
          {draft.kind === 'count' ? copy.kindCount : copy.kindDaily}
        </span>
      )}
      {draft.kind === 'count' ? (
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
      ) : null}
      <span className="flex items-center gap-1.5" aria-label={copy.window}>
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
    </>
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
      className="flex flex-wrap items-center gap-2 rounded-[14px] border border-dashed border-border bg-elevated px-3 py-2.5"
    >
      <HabitFields draft={draft} onChange={setDraft} kindEditable />
      <button
        type="submit"
        disabled={create.isPending || draftToInput(draft) === null}
        className="h-9 shrink-0 rounded-md bg-accent px-4 text-[length:var(--text-meta)] font-medium text-on-accent transition-colors duration-[var(--ease-out)] hover:bg-accent-hover disabled:opacity-50"
      >
        {copy.submit}
      </button>
      <button
        type="button"
        onClick={onDone}
        className="h-9 shrink-0 rounded-md px-3 text-[length:var(--text-meta)] text-muted transition-colors duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
      >
        {copy.cancel}
      </button>
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
      <li data-habit-row={habit.id} className="border-b border-border py-2.5 last:border-b-0">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const input = draftToPatch(draft);
            if (input) patch.mutate(input);
          }}
        >
          <HabitFields draft={draft} onChange={setDraft} kindEditable={false} />
          <button
            type="submit"
            disabled={patch.isPending || draftToPatch(draft) === null}
            className="h-8 shrink-0 rounded-md bg-accent-subtle px-3 text-[length:var(--text-caption)] font-medium text-fg transition-colors duration-[var(--ease-out)] hover:bg-surface-muted disabled:opacity-50"
          >
            {copy.save}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(draftFromHabit(habit));
              setEditing(false);
            }}
            className="h-8 shrink-0 rounded-md px-2.5 text-[length:var(--text-caption)] text-muted transition-colors duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          >
            {copy.cancel}
          </button>
        </form>
      </li>
    );
  }

  return (
    <li
      data-habit-row={habit.id}
      data-habit-active={habit.active ? 'true' : 'false'}
      className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border py-2.5 last:border-b-0 ${
        habit.active ? '' : 'opacity-50'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[length:var(--text-body)] font-medium text-fg">
          <span className="truncate">{habit.name}</span>
          {habit.createdBy === 'agent' ? (
            <span className="shrink-0 rounded-full bg-accent-subtle px-2 py-0.5 text-[11px] font-medium text-fg">
              {copy.agentBadge}
            </span>
          ) : null}
          {!habit.active ? (
            <span className="shrink-0 text-[length:var(--text-caption)] font-normal text-tertiary">
              {copy.inactive}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex flex-wrap gap-1.5">
          {habitMeta(habit).map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-tertiary"
            >
              {chip}
            </span>
          ))}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
        >
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
              className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-danger transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted disabled:opacity-60"
            >
              {copy.confirmDelete}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
            >
              {copy.cancel}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-danger"
          >
            {copy.del}
          </button>
        )}
      </span>
    </li>
  );
}

export function HabitsSection() {
  const query = useHabitsQuery();
  const [adding, setAdding] = useState(false);

  if (query.isPending) {
    return (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">…</p>
    );
  }

  const habits = query.data ?? [];

  return (
    <div className="flex flex-col gap-5" data-region="habits-manage">
      <div>
        {adding ? (
          <AddHabitForm onDone={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-3 text-[length:var(--text-meta)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          >
            + {copy.add}
          </button>
        )}
      </div>

      {habits.length === 0 ? (
        <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {copy.empty}
        </p>
      ) : (
        <ul className="flex flex-col">
          {habits.map((habit) => (
            <HabitRow key={habit.id} habit={habit} />
          ))}
        </ul>
      )}
    </div>
  );
}
