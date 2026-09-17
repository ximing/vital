import { RequireAuth } from '../src/components/RequireAuth';
import { DaysHome } from '../src/features/days/DaysHome';

export default function DaysScreen() {
  return (
    <RequireAuth>
      <DaysHome />
    </RequireAuth>
  );
}
