import { RequireAuth } from '../src/components/RequireAuth';
import { ThreadsHome } from '../src/features/threads/ThreadsHome';

export default function ThreadsScreen() {
  return (
    <RequireAuth>
      <ThreadsHome />
    </RequireAuth>
  );
}
