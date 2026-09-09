import type { Habit, Task } from '@vital/dto';
import { TaskCheckbox } from '@/features/todos/TaskRow';
import { habitChipText } from './model';

/** A habit instance in the today list: checkbox + name + progress chip（如「喝水 3/8」）. */
export function HabitRow({
  task,
  habit,
  timeZone,
  onComplete,
}: {
  task: Task;
  habit: Habit | undefined;
  timeZone: string;
  onComplete: (task: Task) => void;
}) {
  return (
    <div data-region="habit-row" className="flex items-center gap-2.5 px-2 py-2">
      <TaskCheckbox task={task} timeZone={timeZone} onToggle={() => onComplete(task)} />
      <span className="min-w-0 truncate text-[length:var(--text-body)] text-fg">
        {habit?.name ?? task.title}
      </span>
      {habit ? (
        <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 font-mono text-[11px] text-tertiary">
          {habitChipText(habit)}
        </span>
      ) : null}
    </div>
  );
}
