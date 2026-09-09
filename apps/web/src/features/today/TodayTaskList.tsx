import type { Habit, List, Tag, Task } from '@vital/dto';
import { ListView } from '@/features/todos/ListView';
import { HabitEmptyCard } from './HabitEmptyCard';
import { HabitRow } from './HabitRow';
import { habitById } from './model';

const TODAY_LIST_ID = 'smart:today';

/**
 * Lower half of /today: today's tasks (smart:today). Open habit instances render
 * as progress rows; a selected outcome card filters the rest to that thread.
 */
export function TodayTaskList({
  tasks,
  habits,
  tags,
  lists,
  timeZone,
  selectedOutcomeId,
  onComplete,
  onReorder,
  onPostpone,
}: {
  tasks: Task[];
  habits: Habit[];
  tags: Tag[];
  lists: List[];
  timeZone: string;
  selectedOutcomeId: string | null;
  onComplete: (task: Task) => void;
  onReorder: (input: { listId: string; parentId: string | null; orderedIds: string[] }) => void;
  onPostpone: (tasks: Task[]) => void;
}) {
  const habitTasks =
    selectedOutcomeId === null
      ? tasks.filter((task) => task.habitId !== null && task.status !== 'done')
      : [];
  const habitTaskIds = new Set(habitTasks.map((task) => task.id));
  const listTasks = tasks.filter((task) => {
    if (habitTaskIds.has(task.id)) return false;
    if (selectedOutcomeId !== null) return task.outcomeId === selectedOutcomeId;
    return true;
  });

  return (
    <div>
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
      {habits.length === 0 && selectedOutcomeId === null ? <HabitEmptyCard /> : null}
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
