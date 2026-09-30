import { bindServices } from '@rabjs/react';
import { useEffect, type FC } from 'react';
import { Outlet, useMatch } from 'react-router';
import { t } from '@/copy';
import { scheduleIdle, warmInboxReader } from '@/shell/warm';
import { EmptyReader } from './EmptyInbox';
import { InboxPageService } from './inbox-page.service';
import { InboxListColumn } from './InboxListPanel';

function InboxEmptyCanvas() {
  return (
    <main
      id="main"
      data-region="reading-canvas"
      className="hidden h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-canvas lg:flex"
    >
      <EmptyReader />
      <p className="sr-only">{t.nav.inbox}</p>
    </main>
  );
}

function InboxWorkspaceContent() {
  useEffect(() => scheduleIdle(warmInboxReader), []);
  const jobsOpen = useMatch('/inbox/jobs') != null;
  const readerMatch = useMatch('/inbox/:id');
  const id = jobsOpen ? undefined : readerMatch?.params.id;
  const canvas = jobsOpen || id !== undefined;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 bg-canvas">
      <InboxListColumn selectedId={id} className={canvas ? 'hidden lg:flex' : 'flex'} />
      {canvas ? <Outlet /> : <InboxEmptyCanvas />}
    </div>
  );
}

export const InboxWorkspace: FC = bindServices(InboxWorkspaceContent, [InboxPageService]);
