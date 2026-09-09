import { t } from '@/copy';
import { EmptyReader } from './EmptyInbox';
import { InboxListColumn } from './InboxListPanel';

export function InboxWorkspace() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 bg-canvas">
      <InboxListColumn />
      <main
        id="main"
        data-region="reading-canvas"
        className="hidden h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-canvas lg:flex"
      >
        <EmptyReader />
        <p className="sr-only">{t.nav.inbox}</p>
      </main>
    </div>
  );
}
