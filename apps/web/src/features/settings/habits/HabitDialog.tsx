import type { CreateHabitInput, Habit, Outcome, PatchHabitInput } from '@vital/dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { client } from '@/api/client';
import { t } from '@/copy';
import { todayKeys } from '@/features/today';
import { FIELD_CONTROL_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { OutcomeField } from '@/ui/outcome-field';
import { Overlay } from '@/ui/overlay';
import { BTN_GHOST_SM } from './classes';
import { draftFromHabit, draftToInput, draftToPatch, EMPTY_DRAFT, type HabitDraft } from './draft';

const copy = t.settings.habits;

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
      <span className="field-shell inline-flex h-9 items-center overflow-hidden rounded-[10px] border border-border bg-surface">
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

export function HabitDialog({
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
