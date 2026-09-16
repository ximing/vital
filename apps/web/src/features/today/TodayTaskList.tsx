import type { Habit, List, Tag, Task } from '@vital/dto';
import { Link } from 'react-router';
import { t } from '@/copy';
import { ListView } from '@/features/todos';
import { HabitCard } from './HabitCard';
import { HabitEmptyCard } from './HabitEmptyCard';
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
          <div className="grid grid-cols-2 gap-2 px-2 pb-2 pt-1 sm:grid-cols-3">
            {activeHabits.map((habit) => (
              <HabitCard
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
      {habitLane && listTasks.length === 0 ? (
        // ListView short-circuits to the empty state when there are no tasks;
        // keep the task group divider so the habit lane still reads as its
        // own group above it.
        <div className="flex items-center gap-1 px-2 pb-2 pt-2" data-region="tasks-group-divider">
          <p className="eyebrow eyebrow-rule min-w-0 flex-1">
            <span className="truncate">{t.lists.today}</span>
            <span className="shrink-0 font-mono font-normal normal-case tracking-normal tabular-nums opacity-80">
              0
            </span>
          </p>
        </div>
      ) : null}
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
