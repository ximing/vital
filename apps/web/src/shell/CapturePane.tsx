import { Archive, Plus, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { t } from '@/copy';
import { EmptyInbox, InboxSkeleton } from '@/features/inbox/EmptyInbox';
import { PendingRow, SaveRow } from '@/features/inbox/InboxRow';
import { useInboxUi } from '@/features/inbox/inbox-ui.service';
import { archivedSaves, groupSavesByDay, PASTE_URL_ID, visibleSaves } from '@/features/inbox/model';
import { useOnline } from '@/features/inbox/online';
import { PasteUrl } from '@/features/inbox/PasteUrl';
import { useInboxActions, useInboxListQuery } from '@/features/inbox/queries';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { humanError } from '@/lib/errors';
import { usePopover } from '@/ui/use-popover';

export function CapturePane() {
  const { id } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const timeZone = useAuth((s) => s.user?.timezone) ?? 'UTC';
  const inboxQuery = useInboxListQuery();
  const inboxActions = useInboxActions();
  const pending = useInboxUi((s) => s.pending);
  const pasteNonce = useInboxUi((s) => s.pasteNonce);
  const preview = useInboxUi((s) => s.preview);
  const pasteRef = useRef<HTMLDivElement>(null);
  const pasteBtnRef = useRef<HTMLButtonElement>(null);
  const pastePopover = usePopover(pasteRef);
  const [pasteAnchor, setPasteAnchor] = useState<{ x: number; y: number } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  function openPaste(): void {
    const rect = pasteBtnRef.current?.getBoundingClientRect();
    if (rect) setPasteAnchor({ x: rect.left, y: rect.bottom + 6 });
    pastePopover.setOpen(true);
  }

  // Empty state / keyboard entry points request the paste dialog via nonce.
  useEffect(() => {
    if (pasteNonce === 0) return;
    openPaste();
    const id = window.setTimeout(() => document.getElementById(PASTE_URL_ID)?.focus(), 0);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteNonce]);

  // A preview arriving (fresh extract or retried pending row) needs the dialog open.
  useEffect(() => {
    if (preview) openPaste();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);
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
      <div ref={pasteRef} className="relative flex items-center justify-between px-3 pb-1.5 pt-3">
        <span className="eyebrow tabular-nums">
          {viewingArchived ? t.inbox.archived : t.nav.inbox} · {items.length}
        </span>
        <div className="flex items-center gap-0.5">
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
          <button
            ref={pasteBtnRef}
            type="button"
            aria-label={t.inbox.pasteUrl}
            aria-expanded={pastePopover.open}
            title={t.inbox.pasteUrl}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-[background-color,color] duration-[var(--ease-out)] ${
              pastePopover.open
                ? 'bg-accent-subtle text-accent'
                : 'text-muted hover:bg-surface-muted hover:text-fg'
            }`}
            onClick={() => (pastePopover.open ? pastePopover.close() : openPaste())}
          >
            <Icon icon={Plus} size={15} />
          </button>
        </div>
        {pastePopover.open && pasteAnchor ? (
          <div
            className={`fixed z-[var(--z-dropdown)] w-[min(26rem,calc(100vw-1rem))] ${FIELD_POPOVER_CLASS}`}
            style={{
              left: Math.max(8, Math.min(pasteAnchor.x, window.innerWidth - 416 - 8)),
              top: pasteAnchor.y,
            }}
          >
            <PasteUrl disabled={!online} />
          </div>
        ) : null}
      </div>
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
                <p className="eyebrow eyebrow-rule px-3 pb-1.5 pt-4">
                  {t.inbox.group[group.key]}
                  <span className="font-mono normal-case tracking-normal tabular-nums opacity-80">{group.items.length}</span>
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
