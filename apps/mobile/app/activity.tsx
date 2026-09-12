import { RequireAuth } from '../src/components/RequireAuth';
import { ActivityHome } from '../src/features/activity/ActivityHome';

export default function ActivityScreen() {
  return (
    <RequireAuth>
      <ActivityHome />
    </RequireAuth>
  );
}
