import type { PatchTaskInput, RecurrenceKind, ReminderOffsetMinutes, Task } from '@vital/dto';
import { t } from '@/copy';
import { DateField } from '@/ui/date-field';
import { SelectField, type SelectOption } from '@/ui/select-field';
import { fromDatetimeLocal, recurrenceKind, toDatetimeLocal } from './model';

export type ReminderValue = 'none' | 'due' | 'custom' | '5' | '15' | '30' | '60' | '1440';
export type RecurrenceValue = RecurrenceKind | 'none' | 'custom';

export const REMINDER_OFFSETS: ReminderOffsetMinutes[] = [5, 15, 30, 60, 1440];
const OFFSETS = REMINDER_OFFSETS;

export function offsetLabel(minutes: ReminderOffsetMinutes): string {
  if (minutes === 5) return t.todos.reminder5m;
  if (minutes === 15) return t.todos.reminder15m;
  if (minutes === 30) return t.todos.reminder30m;
  if (minutes === 60) return t.todos.reminder1h;
  return t.todos.reminder1d;
}

export function reminderSelectValue(task: Task): ReminderValue {
  const mode = task.reminderMode ?? 'none';
  if (mode === 'offset') {
    const minutes = task.reminderOffsetMinutes ?? 15;
    return String(minutes) as ReminderValue;
  }
  return mode;
}

export function recurrenceSelectValue(task: Task): RecurrenceValue {
  if (task.recurrenceKind) return task.recurrenceKind;
  return recurrenceKind(task.recurrence);
}

export function RecurrenceField({
  task,
  onPatch,
}: {
  task: Task;
  onPatch: (input: PatchTaskInput) => void;
}) {
  const value = recurrenceSelectValue(task);
  const options: SelectOption<RecurrenceValue>[] = [
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
  if (value === 'custom') {
    options.push({ value: 'custom', label: task.recurrence ?? t.todos.recurrence, disabled: true });
  }

  return (
    <SelectField
      value={value}
      options={options}
      ariaLabel={t.todos.recurrence}
      onChange={(next) => {
        if (next === 'custom') return;
        if (next === 'none') onPatch({ recurrence: null, recurrenceKind: null });
        else onPatch({ recurrence: null, recurrenceKind: next });
      }}
    />
  );
}

export function ReminderField({
  task,
  zone,
  weekStartsOn,
  onPatch,
}: {
  task: Task;
  zone: string;
  weekStartsOn: 0 | 1;
  onPatch: (input: PatchTaskInput) => void;
}) {
  const mode = task.reminderMode ?? 'none';
  const value = reminderSelectValue(task);
  const hasDue = task.dueAt !== null;
  const options: SelectOption<ReminderValue>[] = [
    { value: 'none', label: t.todos.reminderNone },
    ...(hasDue
      ? ([
          { value: 'due', label: t.todos.reminderDue },
          ...OFFSETS.map((minutes) => ({
            value: String(minutes) as ReminderValue,
            label: offsetLabel(minutes),
          })),
        ] satisfies SelectOption<ReminderValue>[])
      : []),
    { value: 'custom', label: t.todos.reminderCustom },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <SelectField
        value={value}
        options={options}
        ariaLabel={t.todos.remind}
        onChange={(next) => {
          if (next === 'none') {
            onPatch({ reminderMode: 'none', reminderOffsetMinutes: null, reminderAt: null });
            return;
          }
          if (next === 'due') {
            onPatch({ reminderMode: 'due', reminderOffsetMinutes: null, reminderAt: null });
            return;
          }
          if (next === 'custom') {
            onPatch({
              reminderMode: 'custom',
              reminderAt: task.reminderAt ?? task.dueAt ?? new Date().toISOString(),
            });
            return;
          }
          onPatch({
            reminderMode: 'offset',
            reminderOffsetMinutes: Number(next) as ReminderOffsetMinutes,
          });
        }}
      />
      {mode === 'custom' ? (
        <DateField
          value={
            task.reminderAt ? toDatetimeLocal(task.reminderAt, zone) : ''
          }
          kind="datetime-local"
          ariaLabel={t.todos.reminderCustom}
          zone={zone}
          weekStartsOn={weekStartsOn}
          onChange={(next) =>
            onPatch(
              next === ''
                ? { reminderMode: 'none', reminderOffsetMinutes: null, reminderAt: null }
                : { reminderMode: 'custom', reminderAt: fromDatetimeLocal(next, zone) },
            )
          }
        />
      ) : null}
    </div>
  );
}
