import { t } from '@/copy';
import { EmptyReader } from './EmptyInbox';

export function InboxWorkspace() {
  return (
    <main id="main" data-region="reading-canvas" className="flex h-full min-h-0 min-w-0 flex-1 flex-col items-center justify-center bg-canvas">
      <EmptyReader />
      <p className="sr-only">{t.nav.inbox}</p>
    </main>
  );
}
