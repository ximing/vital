import { useLocalSearchParams } from 'expo-router';
import { RequireAuth } from '../../../src/components/RequireAuth';
import { TaskDetail } from '../../../src/features/todos/TaskDetail';

export default function TaskScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return (
    <RequireAuth>
      <TaskDetail taskId={id} />
    </RequireAuth>
  );
}
