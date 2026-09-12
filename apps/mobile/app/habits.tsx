import { RequireAuth } from '../src/components/RequireAuth';
import { HabitsHome } from '../src/features/habits/HabitsHome';

export default function HabitsScreen() {
  return (
    <RequireAuth>
      <HabitsHome />
    </RequireAuth>
  );
}
