import { Archive, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { t } from '@/copy';
import { EmptyInbox, InboxSkeleton } from '@/features/inbox/EmptyInbox';
import { PendingRow, SaveRow } from '@/features/inbox/InboxRow';
import { useInboxUi } from '@/features/inbox/inbox-ui.service';
import { archivedSaves, groupSavesByDay, visibleSaves } from '@/features/inbox/model';
import { useOnline } from '@/features/inbox/online';
import { PasteUrl } from '@/features/inbox/PasteUrl';
import { useInboxActions, useInboxListQuery } from '@/features/inbox/queries';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { humanError } from '@/lib/errors';

export function CapturePane() {
  const { id } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const timeZone = useAuth((s) => s.user?.timezone) ?? 'UTC';
  const inboxQuery = useInboxListQuery();
  const inboxActions = useInboxActions();
  const pending = useInboxUi((s) => s.pending);
  const [showArchived, setShowArchived] = useState(false);
  const all = inboxQuery.data ?? [];
  const archived = archivedSaves(all);
  const viewingArchived = showArchived && archived.length > 0;
  const items = viewingArchived ? archived : visibleSaves(all);
  const empty =
    items.length === 0 &&
    pending.length === 0 &&
    !inboxQuery.isLoading &&
    archived.length === 0;

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
          <div role="list" aria-label={viewingArchived ? t.inbox.archived : t.nav.inbox}>
            <div className="flex items-center justify-between px-3 pb-0.5 pt-1">
              <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] tabular-nums text-tertiary">
                {viewingArchived ? t.inbox.archived : t.nav.inbox} · {items.length}
              </span>
              {archived.length > 0 ? (
                <button
                  type="button"
                  aria-label={viewingArchived ? t.inbox.hideArchived : t.inbox.showArchived}
                  className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
                  onClick={() => setShowArchived((value) => !value)}
                >
                  <Icon icon={viewingArchived ? Undo2 : Archive} size={12} />
                  {viewingArchived ? t.inbox.hideArchived : t.inbox.showArchived}
                </button>
              ) : null}
            </div>
            {viewingArchived
              ? null
              : pending.map((save) => (
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
            {groupSavesByDay(items, timeZone).map((group) => (
              <div key={group.key}>
                <p className="flex items-baseline gap-1 px-3 pb-0.5 pt-2.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] font-medium text-tertiary">
                  {t.inbox.group[group.key]}
                  <span className="tabular-nums">{group.items.length}</span>
                </p>
                {group.items.map((item) => (
                  <SaveRow
                    key={item.id}
                    item={item}
                    timeZone={timeZone}
                    selected={id === item.id}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
