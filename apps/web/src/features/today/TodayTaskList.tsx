import type { Habit, List, Tag, Task } from '@vital/dto';
import { Link } from 'react-router';
import { t } from '@/copy';
import { ListView } from '@/features/todos/ListView';
import { HabitEmptyCard } from './HabitEmptyCard';
import { HabitRow } from './HabitRow';
import { habitTodayProgress, habitTodayTask } from './model';

const TODAY_LIST_ID = 'smart:today';

/**
 * Lower half of /today: today's tasks (smart:today). Active habits always
 * render in the lane (including completed ones) so today's progress stays
 * visible. Regular tasks sit below; habit instances are not mixed into that list.
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
  const activeHabits = habits.filter((habit) => habit.active);
  const listTasks = tasks.filter((task) => task.habitId === null);
  const habitLane = activeHabits.length > 0;
  const habitDone = activeHabits.reduce((sum, habit) => sum + habitTodayProgress(habit).done, 0);
  const habitTotal = activeHabits.reduce((sum, habit) => sum + habitTodayProgress(habit).total, 0);

  return (
    <div>
      {habitLane ? (
        <div>
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
              to="/habits"
              className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[length:var(--text-meta)] text-tertiary transition-colors hover:bg-surface-muted hover:text-fg"
            >
              {t.today.manageHabits}
            </Link>
          </div>
          <div className="px-0 pb-1 pt-1">
            {activeHabits.map((habit) => (
              <HabitRow
                key={habit.id}
                habit={habit}
                task={habitTodayTask(tasks, habit.id)}
                onComplete={onComplete}
              />
            ))}
          </div>
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
