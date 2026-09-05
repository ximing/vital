import { RequireAuth } from '../../src/components/RequireAuth';
import { InboxCompose } from '../../src/features/inbox/InboxCompose';

export default function InboxNewScreen() {
  return (
    <RequireAuth>
      <InboxCompose />
    </RequireAuth>
  );
}
