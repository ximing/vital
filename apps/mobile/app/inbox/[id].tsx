import { useLocalSearchParams } from 'expo-router';
import { RequireAuth } from '../../src/components/RequireAuth';
import { InboxDetail } from '../../src/features/inbox/InboxDetail';

export default function InboxItemScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return (
    <RequireAuth>
      <InboxDetail inboxId={id} />
    </RequireAuth>
  );
}
