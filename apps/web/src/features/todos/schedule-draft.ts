import type {
  CreateTaskInput,
  PatchTaskInput,
  RecurrenceKind,
  ReminderOffsetMinutes,
  Task,
} from '@vital/dto';
import { t } from '@/copy';
import {
  formatHm,
  formatHumanDay,
  fromDatetimeLocal,
  toDateInput,
  toDatetimeLocal,
  todayYmd,
  zonedLocalMidnightIso,
} from './model';
import type { ReminderValue } from './schedule-fields';

export type ScheduleMode = 'point' | 'range';

export type ScheduleDraft = {
  mode: ScheduleMode;
  startYmd: string | null;
  endYmd: string | null;
  startHm: string | null;
  endHm: string | null;
  reminder: ReminderValue;
  reminderAt: string | null;
  recurrenceKind: RecurrenceKind | null;
};

export function emptyScheduleDraft(): ScheduleDraft {
  return {
    mode: 'point',
    startYmd: null,
    endYmd: null,
    startHm: null,
    endHm: null,
    reminder: 'none',
    reminderAt: null,
    recurrenceKind: null,
  };
}

function hmOf(iso: string, zone: string, allDay: boolean): string | null {
  if (allDay) return null;
  const local = toDatetimeLocal(iso, zone);
  return local.slice(11, 16) || null;
}

export function draftFromTask(task: Task, zone: string): ScheduleDraft {
  const startYmd = task.startAt ? toDateInput(task.startAt, zone) : null;
  const dueYmd = task.dueAt ? toDateInput(task.dueAt, zone) : null;
  const range = startYmd !== null && dueYmd !== null;
  const reminder: ReminderValue =
    task.reminderMode === 'offset'
      ? (String(task.reminderOffsetMinutes ?? 15) as ReminderValue)
      : ((task.reminderMode ?? 'none') as ReminderValue);
  return {
    mode: range ? 'range' : 'point',
    startYmd: range ? startYmd : (dueYmd ?? startYmd),
    endYmd: range ? dueYmd : null,
    startHm: range
      ? hmOf(task.startAt ?? '', zone, task.isAllDay)
      : task.dueAt
        ? hmOf(task.dueAt, zone, task.isAllDay)
        : task.startAt
          ? hmOf(task.startAt, zone, task.isAllDay)
          : null,
    endHm: range ? hmOf(task.dueAt ?? '', zone, task.isAllDay) : null,
    reminder,
    reminderAt: task.reminderAt,
    recurrenceKind: task.recurrenceKind,
  };
}

function stamp(ymd: string, hm: string | null, zone: string): string {
  if (hm === null || hm === '') return zonedLocalMidnightIso(ymd, zone);
  return fromDatetimeLocal(`${ymd}T${hm}`, zone);
}

function reminderPatch(draft: ScheduleDraft): Pick<
  PatchTaskInput,
  'reminderMode' | 'reminderOffsetMinutes' | 'reminderAt'
> {
  if (draft.reminder === 'none') {
    return { reminderMode: 'none', reminderOffsetMinutes: null, reminderAt: null };
  }
  if (draft.reminder === 'due') {
    return { reminderMode: 'due', reminderOffsetMinutes: null, reminderAt: null };
  }
  if (draft.reminder === 'custom') {
    return {
      reminderMode: 'custom',
      reminderOffsetMinutes: null,
      reminderAt: draft.reminderAt,
    };
  }
  return {
    reminderMode: 'offset',
    reminderOffsetMinutes: Number(draft.reminder) as ReminderOffsetMinutes,
    reminderAt: null,
  };
}

export function draftToPatch(draft: ScheduleDraft, zone: string): PatchTaskInput {
  const remind = reminderPatch(draft);
  // The server rejects patches carrying both recurrence and recurrenceKind;
  // the kind form alone also clears any legacy rrule.
  const repeat = { recurrenceKind: draft.recurrenceKind };
  if (draft.startYmd === null) {
    return {
      dueAt: null,
      startAt: null,
      isAllDay: true,
      ...remind,
      ...repeat,
    };
  }
  if (draft.mode === 'point') {
    return {
      startAt: null,
      dueAt: stamp(draft.startYmd, draft.startHm, zone),
      isAllDay: draft.startHm === null,
      ...remind,
      ...repeat,
    };
  }
  const endYmd = draft.endYmd ?? draft.startYmd;
  const allDay = draft.startHm === null && draft.endHm === null;
  return {
    startAt: stamp(draft.startYmd, draft.startHm, zone),
    dueAt: stamp(endYmd, draft.endHm ?? draft.startHm, zone),
    isAllDay: allDay,
    ...remind,
    ...repeat,
  };
}

export function applyDraftToCreate(
  base: CreateTaskInput,
  draft: ScheduleDraft,
  zone: string,
): CreateTaskInput {
  if (draft.startYmd === null && draft.reminder === 'none' && draft.recurrenceKind === null) {
    return base;
  }
  const patch = draftToPatch(draft, zone);
  const next: CreateTaskInput = { ...base };
  // CreateTaskInput's notes/reminderMode are non-nullable; copy only defined fields.
  if (patch.dueAt !== undefined) next.dueAt = patch.dueAt;
  if (patch.startAt !== undefined) next.startAt = patch.startAt;
  if (patch.isAllDay !== undefined) next.isAllDay = patch.isAllDay;
  if (patch.reminderMode) next.reminderMode = patch.reminderMode;
  if (patch.reminderOffsetMinutes !== undefined) {
    next.reminderOffsetMinutes = patch.reminderOffsetMinutes;
  }
  if (patch.reminderAt !== undefined) next.reminderAt = patch.reminderAt;
  if (patch.recurrenceKind !== undefined) next.recurrenceKind = patch.recurrenceKind;
  return next;
}

export function draftSummary(draft: ScheduleDraft, zone: string): string {
  if (draft.startYmd === null) return t.todos.addDate;
  const startDay = formatHumanDay(draft.startYmd, zone);
  if (draft.mode === 'point') {
    return draft.startHm ? `${startDay} ${draft.startHm}` : startDay;
  }
  const endYmd = draft.endYmd ?? draft.startYmd;
  const endDay = formatHumanDay(endYmd, zone);
  const start = draft.startHm ? `${startDay} ${draft.startHm}` : startDay;
  const end = draft.endHm ? `${endDay} ${draft.endHm}` : endDay;
  return `${start} – ${end}`;
}

/** Point-date patch for one day, keeping the task's time-of-day when it has one. */
export function scheduleDayPatch(task: Task, ymd: string, zone: string): PatchTaskInput {
  if (task.isAllDay || task.dueAt === null) {
    return { startAt: null, dueAt: zonedLocalMidnightIso(ymd, zone), isAllDay: true };
  }
  return {
    startAt: null,
    dueAt: fromDatetimeLocal(`${ymd}T${formatHm(task.dueAt, zone)}`, zone),
    isAllDay: false,
  };
}

export function ymdDiffDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function absDay(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8))}日`;
}

export function draftChip(
  draft: ScheduleDraft,
  zone: string,
  now = new Date(),
): { text: string; overdue: boolean } {
  if (draft.startYmd === null) return { text: t.todos.addDate, overdue: false };
  const today = todayYmd(zone, now);
  if (draft.mode === 'point') {
    const bits = [absDay(draft.startYmd)];
    if (draft.startHm) bits.push(draft.startHm);
    const overdue = draft.startYmd < today;
    if (overdue) bits.push(`延期${ymdDiffDays(draft.startYmd, today)}天`);
    return { text: bits.join(', '), overdue };
  }
  const endYmd = draft.endYmd ?? draft.startYmd;
  const overdue = endYmd < today;
  const delay = overdue ? `, 延期${ymdDiffDays(endYmd, today)}天` : '';
  if (endYmd === draft.startYmd && !draft.startHm && !draft.endHm) {
    return { text: `${absDay(draft.startYmd)}${delay}`, overdue };
  }
  const start = draft.startHm ? `${absDay(draft.startYmd)} ${draft.startHm}` : absDay(draft.startYmd);
  const end = draft.endHm ? `${absDay(endYmd)} ${draft.endHm}` : absDay(endYmd);
  return { text: `${start} – ${end}${delay}`, overdue };
}
