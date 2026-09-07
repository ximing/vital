import { useNavigate, useParams } from 'react-router';
import { t } from '@/copy';
import { EmptyInbox, InboxSkeleton } from '@/features/inbox/EmptyInbox';
import { PendingRow, SaveRow } from '@/features/inbox/InboxRow';
import { useInboxUi } from '@/features/inbox/inbox-ui.service';
import { visibleSaves } from '@/features/inbox/model';
import { useOnline } from '@/features/inbox/online';
import { PasteUrl } from '@/features/inbox/PasteUrl';
import { useInboxActions, useInboxListQuery } from '@/features/inbox/queries';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { humanError } from '@/lib/errors';

export function CapturePane() {
  const { id } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const timeZone = useAuth((s) => s.user?.timezone) ?? 'UTC';
  const inboxQuery = useInboxListQuery();
  const inboxActions = useInboxActions();
  const pending = useInboxUi((s) => s.pending);
  const items = visibleSaves(inboxQuery.data ?? []);
  const empty = items.length === 0 && pending.length === 0 && !inboxQuery.isLoading;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
      <PasteUrl disabled={!online} />
      {inboxQuery.error ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <Banner>{humanError(inboxQuery.error)}</Banner>
          <Button variant="ghost" onClick={() => void inboxQuery.refetch()}>
            {t.inbox.retry}
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {inboxQuery.isLoading ? (
          <InboxSkeleton />
        ) : empty ? (
          <EmptyInbox />
        ) : (
          <div role="list" aria-label={t.nav.inbox}>
            {pending.map((save) => (
              <PendingRow
                key={save.id}
                save={save}
                disabled={!online || save.phase === 'processing'}
                onRetry={() => {
                  void inboxActions.retry(save).then((result) => {
                    if (result && 'id' in result) navigate(`/inbox/${result.id}`);
                  });
                }}
              />
            ))}
            {items.map((item) => (
              <SaveRow key={item.id} item={item} timeZone={timeZone} selected={id === item.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
