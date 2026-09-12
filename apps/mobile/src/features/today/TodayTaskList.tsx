import { View } from 'react-native';
import type { List, Tag, Task } from '@vital/dto';
import { TaskRow } from '../../components/TaskRow';
import { copy } from '../../lib/copy';
import { nestTasks } from '../../lib/format';
import { useOpenTask } from '../../components/TaskSheetHost';

/**
 * 今天任务列表（spec §f.7）：任务行复用 §1.4 共享 TaskRow。
 * 习惯任务已上移到 HabitLane（spec §f.5），这里只渲染普通任务。
 */
export function TodayTaskList({
  tasks,
  tags,
  lists,
  onComplete,
}: {
  tasks: Task[];
  tags: Tag[];
  lists: List[];
  onComplete: (task: Task) => void;
}) {
  const openTask = useOpenTask();
  const live = tasks.filter((task) => task.deletedAt === null && task.habitId === null);
  const nested = nestTasks(live);

  function listNameOf(task: Task): string | undefined {
    const found = lists.find((row) => row.id === task.listId);
    if (!found) return undefined;
    return found.kind === 'inbox' ? copy.lists.inbox : found.name;
  }

  return (
    <>
      {nested.map((node) => (
        <View key={node.task.id}>
          <TaskRow
            task={node.task}
            tags={tags}
            listName={listNameOf(node.task)}
            onToggle={onComplete}
            onPress={(row) => openTask(row.id)}
          />
          {node.children.map((child) => (
            <TaskRow
              key={child.id}
              task={child}
              indent
              tags={tags}
              listName={listNameOf(child)}
              onToggle={onComplete}
              onPress={(row) => openTask(row.id)}
            />
          ))}
        </View>
      ))}
    </>
  );
}
