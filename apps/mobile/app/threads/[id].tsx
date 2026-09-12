import { useLocalSearchParams } from 'expo-router';
import { RequireAuth } from '../../src/components/RequireAuth';
import { ThreadDetail } from '../../src/features/threads/ThreadDetail';

export default function ThreadDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return (
    <RequireAuth>
      <ThreadDetail outcomeId={id} />
    </RequireAuth>
  );
}
