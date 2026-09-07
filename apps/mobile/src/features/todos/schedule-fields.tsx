import type { PatchTaskInput, RecurrenceKind, ReminderOffsetMinutes, Task } from '@vital/dto';
import { DateField } from '../../components/DateField';
import { SelectField, type SelectOption } from '../../components/SelectField';
import { copy } from '../../lib/copy';
import { fromDatetimeLocal, toDatetimeLocal } from '../../lib/format';
import {
  offsetLabel,
  recurrenceSelectValue,
  reminderSelectValue,
  type RecurrenceValue,
  type ReminderValue,
} from '../../lib/schedule';

const OFFSETS: ReminderOffsetMinutes[] = [5, 15, 30, 60, 1440];

export function RecurrenceField({
  task,
  onPatch,
}: {
  task: Task;
  onPatch: (input: PatchTaskInput) => void;
}) {
  const value = recurrenceSelectValue(task);
  const options: SelectOption<RecurrenceValue>[] = [
    { value: 'none', label: copy.todos.recurrenceNone },
    { value: 'daily', label: copy.todos.recurrenceDaily },
    { value: 'weekly', label: copy.todos.recurrenceWeekly },
    { value: 'monthly', label: copy.todos.recurrenceMonthly },
    { value: 'yearly', label: copy.todos.recurrenceYearly },
    { value: 'weekdays', label: copy.todos.recurrenceWeekdays },
    { value: 'weekends', label: copy.todos.recurrenceWeekends },
    { value: 'holidays', label: copy.todos.recurrenceHolidays },
    { value: 'legal_workdays', label: copy.todos.recurrenceLegalWorkdays },
  ];
  if (value === 'custom') {
    options.push({ value: 'custom', label: task.recurrence ?? copy.todos.recurrence, disabled: true });
  }

  return (
    <SelectField
      label={copy.todos.recurrence}
      value={value}
      options={options}
      onChange={(next) => {
        if (next === 'custom') return;
        if (next === 'none') onPatch({ recurrence: null, recurrenceKind: null });
        else onPatch({ recurrence: null, recurrenceKind: next as RecurrenceKind });
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
    { value: 'none', label: copy.todos.reminderNone },
    ...(hasDue
      ? ([
          { value: 'due', label: copy.todos.reminderDue },
          ...OFFSETS.map((minutes) => ({
            value: String(minutes) as ReminderValue,
            label: offsetLabel(minutes),
          })),
        ] satisfies SelectOption<ReminderValue>[])
      : []),
    { value: 'custom', label: copy.todos.reminderCustom },
  ];

  return (
    <>
      <SelectField
        label={copy.todos.remind}
        value={value}
        options={options}
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
          label={copy.todos.reminderCustom}
          value={
            task.reminderAt ? toDatetimeLocal(task.reminderAt, zone) : ''
          }
          kind="datetime-local"
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
    </>
  );
}
