import { Service } from '@rabjs/react';
import type { CreateHabitInput, Habit, HabitKind, PatchHabitInput } from '@vital/dto';
import { toast } from '../../components/toast';
import { client } from '../../lib/api';
import { copy } from '../../lib/copy';
import { humanError } from '../../lib/errors';
import { pullSync, subscribeSync } from '../../lib/sync';

const SYNC_DEBOUNCE_MS = 500;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type HabitDraft = {
  id: string | null;
  name: string;
  kind: HabitKind;
  targetCount: string;
  windowStart: string;
  windowEnd: string;
};

export const EMPTY_HABIT_DRAFT: HabitDraft = {
  id: null,
  name: '',
  kind: 'daily',
  targetCount: '8',
  windowStart: '',
  windowEnd: '',
};

export function draftFromHabit(habit: Habit): HabitDraft {
  return {
    id: habit.id,
    name: habit.name,
    kind: habit.kind,
    targetCount: habit.targetCount === null ? '' : String(habit.targetCount),
    windowStart: habit.windowStart ?? '',
    windowEnd: habit.windowEnd ?? '',
  };
}

export function draftError(draft: HabitDraft): string | null {
  if (draft.name.trim() === '') return copy.habits.invalidName;
  if (draft.kind === 'count') {
    const target = Number(draft.targetCount);
    if (!Number.isInteger(target) || target < 1 || target > 99) return copy.habits.invalidTarget;
  }
  for (const value of [draft.windowStart, draft.windowEnd]) {
    if (value !== '' && !HM_RE.test(value)) return copy.habits.invalidWindow;
  }
  return null;
}

function draftToCreate(draft: HabitDraft): CreateHabitInput {
  const base = {
    name: draft.name.trim(),
    windowStart: draft.windowStart === '' ? undefined : draft.windowStart,
    windowEnd: draft.windowEnd === '' ? undefined : draft.windowEnd,
  };
  if (draft.kind === 'count') return { ...base, kind: 'count', targetCount: Number(draft.targetCount) };
  return { ...base, kind: 'daily' };
}

function draftToPatch(draft: HabitDraft): PatchHabitInput {
  const patch: PatchHabitInput = {
    name: draft.name.trim(),
    windowStart: draft.windowStart === '' ? null : draft.windowStart,
    windowEnd: draft.windowEnd === '' ? null : draft.windowEnd,
  };
  if (draft.kind === 'count') patch.targetCount = Number(draft.targetCount);
  return patch;
}

export class HabitsService extends Service {
  habits: Habit[] = [];
  loading = true;
  refreshing = false;
  error: string | null = null;
  draft: HabitDraft | null = null;
  formError: string | null = null;
  saving = false;
  menuHabit: Habit | null = null;

  private inFlight: Promise<void> | null = null;
  private hasData = false;
  private unsubSync: (() => void) | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.unsubSync) return;
    this.unsubSync = subscribeSync(() => {
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => void this.load(false), SYNC_DEBOUNCE_MS);
    });
  }

  stop(): void {
    this.unsubSync?.();
    this.unsubSync = null;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async load(isRefresh: boolean): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    const run = (async () => {
      if (isRefresh) this.refreshing = true;
      else if (!this.hasData) this.loading = true;
      try {
        this.habits = await client.listHabits();
        this.hasData = true;
        this.error = null;
      } catch (err) {
        this.error = humanError(err);
      } finally {
        this.loading = false;
        this.refreshing = false;
      }
    })();
    this.inFlight = run;
    try {
      await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
    }
  }

  async reloadFromFocus(): Promise<void> {
    await pullSync().catch(() => null);
    await this.load(false);
  }

  async runAction(work: () => Promise<void>): Promise<void> {
    try {
      await work();
      await this.load(false);
    } catch (err) {
      toast(humanError(err));
    }
  }

  openCreate(): void {
    this.formError = null;
    this.draft = { ...EMPTY_HABIT_DRAFT };
  }

  openEdit(habit: Habit): void {
    this.formError = null;
    this.draft = draftFromHabit(habit);
    this.menuHabit = null;
  }

  closeDraft(): void {
    this.draft = null;
    this.formError = null;
  }

  patchDraft(patch: Partial<HabitDraft>): void {
    if (this.draft === null) return;
    this.draft = { ...this.draft, ...patch };
  }

  openMenu(habit: Habit): void {
    this.menuHabit = habit;
  }

  closeMenu(): void {
    this.menuHabit = null;
  }

  async saveDraft(): Promise<void> {
    if (this.draft === null || this.saving) return;
    const invalid = draftError(this.draft);
    if (invalid !== null) {
      this.formError = invalid;
      return;
    }
    this.saving = true;
    this.formError = null;
    try {
      if (this.draft.id === null) await client.createHabit(draftToCreate(this.draft));
      else await client.patchHabit(this.draft.id, draftToPatch(this.draft));
      this.draft = null;
      await this.load(false);
    } catch (err) {
      this.formError = humanError(err);
    } finally {
      this.saving = false;
    }
  }

  async setActive(habit: Habit, active: boolean): Promise<void> {
    await this.runAction(() => client.patchHabit(habit.id, { active }).then(() => undefined));
  }

  async remove(habit: Habit): Promise<void> {
    await this.runAction(() => client.deleteHabit(habit.id).then(() => undefined));
  }
}
