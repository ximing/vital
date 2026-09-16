import { bindServices } from '@rabjs/react';
import type { FC } from 'react';
import { Outlet, useMatch } from 'react-router';
import { t } from '@/copy';
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
  const readerMatch = useMatch('/inbox/:id');
  const id = readerMatch?.params.id;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 bg-canvas">
      <InboxListColumn selectedId={id} className={id ? 'hidden lg:flex' : 'flex'} />
      {id ? <Outlet /> : <InboxEmptyCanvas />}
    </div>
  );
}

export const InboxWorkspace: FC = bindServices(InboxWorkspaceContent, [InboxPageService]);
