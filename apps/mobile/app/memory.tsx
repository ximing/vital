import { RequireAuth } from '../src/components/RequireAuth';
import { MemoryHome } from '../src/features/memory/MemoryHome';

export default function MemoryScreen() {
  return (
    <RequireAuth>
      <MemoryHome />
    </RequireAuth>
  );
}
