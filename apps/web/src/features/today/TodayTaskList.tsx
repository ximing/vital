import type { Habit, List, Tag, Task } from '@vital/dto';
import { Link } from 'react-router';
import { t } from '@/copy';
import { ListView } from '@/features/todos/ListView';
import { HabitEmptyCard } from './HabitEmptyCard';
import { HabitRow } from './HabitRow';
import { habitById } from './model';

const TODAY_LIST_ID = 'smart:today';

/**
 * Lower half of /today: today's tasks (smart:today). Open habit instances render
 * as progress rows. Thread cards navigate to the thread page instead of filtering.
 */
export function TodayTaskList({
  tasks,
  habits,
  tags,
  lists,
  timeZone,
  onComplete,
  onReorder,
  onPostpone,
}: {
  tasks: Task[];
  habits: Habit[];
  tags: Tag[];
  lists: List[];
  timeZone: string;
  onComplete: (task: Task) => void;
  onReorder: (input: { listId: string; parentId: string | null; orderedIds: string[] }) => void;
  onPostpone: (tasks: Task[]) => void;
}) {
  const habitTasks = tasks.filter((task) => task.habitId !== null && task.status !== 'done');
  const habitTaskIds = new Set(habitTasks.map((task) => task.id));
  const listTasks = tasks.filter((task) => !habitTaskIds.has(task.id));
  const habitLane = habits.length > 0;
  const habitDone = habits.reduce((sum, habit) => sum + habit.todayDone, 0);
  const habitTotal = habits.reduce((sum, habit) => sum + habit.todayTotal, 0);

  return (
    <div>
      {habitLane ? (
        <div className="flex items-center gap-2 px-2 pb-0.5 pt-1">
          <p className="eyebrow eyebrow-rule min-w-0 flex-1">
            {t.today.habitLane}
            {habitTotal > 0
              ? ` · ${t.today.habitLaneToday
                  .replace('{done}', String(habitDone))
                  .replace('{total}', String(habitTotal))}`
              : ''}
          </p>
          <Link
            to="/settings?tab=habits"
            className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[length:var(--text-meta)] text-tertiary transition-colors hover:bg-surface-muted hover:text-fg"
          >
            {t.today.manageHabits}
          </Link>
        </div>
      ) : null}
      {habitTasks.length > 0 ? (
        <div className="px-0 pb-1 pt-1">
          {habitTasks.map((task) => (
            <HabitRow
              key={task.id}
              task={task}
              habit={habitById(habits, task.habitId)}
              timeZone={timeZone}
              onComplete={onComplete}
            />
          ))}
        </div>
      ) : null}
      {habits.length === 0 ? <HabitEmptyCard /> : null}
      <ListView
        listId={TODAY_LIST_ID}
        tasks={listTasks}
        tags={tags}
        lists={lists}
        timeZone={timeZone}
        onComplete={onComplete}
        onReorder={onReorder}
        onPostpone={onPostpone}
      />
    </div>
  );
}
