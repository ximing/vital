import { t } from '@/copy';
import { EmptyReader } from './EmptyInbox';

export function InboxWorkspace() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6">
      <EmptyReader />
      <p className="sr-only">{t.nav.inbox}</p>
    </div>
  );
}
