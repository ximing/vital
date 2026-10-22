import type { CreateHabitInput, Habit, HabitKind, PatchHabitInput } from '@vital/dto';

export interface HabitDraft {
  name: string;
  kind: HabitKind;
  targetCount: string;
  windowStart: string;
  windowEnd: string;
  outcomeId: string | null;
}

export function draftFromHabit(habit: Habit): HabitDraft {
  return {
    name: habit.name,
    kind: habit.kind,
    targetCount: habit.targetCount === null ? '' : String(habit.targetCount),
    windowStart: habit.windowStart ?? '',
    windowEnd: habit.windowEnd ?? '',
    outcomeId: habit.outcomeId,
  };
}

export const EMPTY_DRAFT: HabitDraft = {
  name: '',
  kind: 'daily',
  targetCount: '8',
  windowStart: '',
  windowEnd: '',
  outcomeId: null,
};

/** Validated draft → API input; null when invalid. */
export function draftToInput(draft: HabitDraft): CreateHabitInput | null {
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

export function draftToPatch(draft: HabitDraft): PatchHabitInput | null {
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
