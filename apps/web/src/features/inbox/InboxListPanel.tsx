import { Plus } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { useAuth } from '@/services/auth.service';
import {
  clampInboxListWidth,
  loadInboxListWidth,
  saveInboxListWidth,
} from '@/shell/chrome';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { usePopover } from '@/ui/use-popover';
import { EmptyInbox, InboxSkeleton } from './EmptyInbox';
import { PendingRow, SaveRow } from './InboxRow';
import {
  canPatchStatus,
  filterSaves,
  groupSavesByDay,
  nextFavoriteStatus,
  parseInboxFilter,
  PASTE_URL_ID,
} from './model';
import { useOnline } from './online';
import { PasteUrl } from './PasteUrl';
import { useInboxActions, useInboxListQuery } from './queries';
import { useInboxUi } from './inbox-ui.service';

const POPOVER_W = 416;

/**
 * Left list column of the inbox canvas: fixed-position next to the library on
 * wide screens (draggable width, persisted), full width on small screens when
 * no reader is open. Keeps /inbox and /inbox/:id visually anchored — opening
 * an article never reflows the list.
 */
export function InboxListColumn({
  selectedId,
  className = 'flex',
}: {
  selectedId?: string;
  className?: string;
}) {
  const [width, setWidth] = useState(() => loadInboxListWidth());
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startW: width };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!drag.current) return;
    setWidth(clampInboxListWidth(drag.current.startW + event.clientX - drag.current.startX));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>): void {
    if (drag.current) saveInboxListWidth(width);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <aside
      aria-label={t.rail.capture}
      className={`relative min-h-0 min-w-0 flex-col overflow-y-auto border-border py-5 lg:w-[var(--inbox-list-w)] lg:shrink-0 lg:border-r ${className}`}
      style={{ '--inbox-list-w': `${width}px` } as CSSProperties}
    >
      <InboxListPanel selectedId={selectedId} />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t.rail.resize}
        className="absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize hover:bg-accent focus-visible:bg-accent lg:block"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </aside>
  );
}

/**
 * The saves list is the protagonist of /inbox: page header (kicker / display
 * title / mono meta), day-grouped rows and the paste popover.
 */
export function InboxListPanel({ selectedId }: { selectedId?: string }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const filter = parseInboxFilter(search.get('filter'));
  const online = useOnline();
  const timeZone = useAuth((s) => s.user?.timezone) ?? 'UTC';
  const inboxQuery = useInboxListQuery();
  const actions = useInboxActions();
  const pending = useInboxUi((s) => s.pending);
  const pasteNonce = useInboxUi((s) => s.pasteNonce);
  const preview = useInboxUi((s) => s.preview);
  const pasteRef = useRef<HTMLDivElement>(null);
  const pasteBtnRef = useRef<HTMLButtonElement>(null);
  const pastePopover = usePopover(pasteRef);
  const [pasteAnchor, setPasteAnchor] = useState<{ right: number; top: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function openPaste(): void {
    const rect = pasteBtnRef.current?.getBoundingClientRect();
    if (rect) setPasteAnchor({ right: window.innerWidth - rect.right, top: rect.bottom + 6 });
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
  const items = filterSaves(all, filter);
  const unreadCount = filterSaves(all, 'unread').length;
  const totalCount = filterSaves(all, 'all').length;
  const groups = groupSavesByDay(items, timeZone);
  const summary = `${totalCount} ${t.inbox.unit} · ${unreadCount} ${t.inbox.unread}`;
  const empty =
    items.length === 0 && pending.length === 0 && !inboxQuery.isLoading && inboxQuery.error === null;

  function patchStatus(id: string, status: 'later' | 'unread' | 'archived'): void {
    setActionError(null);
    void actions.patch.mutateAsync({ id, input: { status } }).catch((err) => {
      setActionError(humanError(err));
    });
  }

  const pasteButton = (
    <button
      ref={pasteBtnRef}
      type="button"
      aria-label={t.inbox.pasteUrl}
      aria-expanded={pastePopover.open}
      title={t.inbox.pasteUrl}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-[background-color,color] duration-[var(--ease-out)] ${
        pastePopover.open
          ? 'bg-accent-subtle text-accent'
          : 'text-muted hover:bg-accent-subtle hover:text-accent'
      }`}
      onClick={() => (pastePopover.open ? pastePopover.close() : openPaste())}
    >
      <Icon icon={Plus} size={16} />
    </button>
  );

  return (
    <div className="px-1">
      <header>
        <div className="flex items-end justify-between gap-3 pb-3">
          <p className="eyebrow eyebrow-accent eyebrow-rule">{t.inbox.kicker}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="h-7 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
          <h1 className="font-display text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)] text-fg">
            {t.rail.capture}
          </h1>
          <div ref={pasteRef} className="relative ml-auto">
            {pasteButton}
            {pastePopover.open && pasteAnchor ? (
              <div
                className={`fixed z-[var(--z-dropdown)] w-[min(26rem,calc(100vw-1rem))] ${FIELD_POPOVER_CLASS}`}
                style={{
                  right: Math.max(8, Math.min(pasteAnchor.right, window.innerWidth - POPOVER_W - 8)),
                  top: pasteAnchor.top,
                }}
              >
                <PasteUrl disabled={!online} />
              </div>
            ) : null}
          </div>
        </div>
        <p className="mt-2 pl-4 font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] tabular-nums text-tertiary">
          {summary}
        </p>
      </header>

      {inboxQuery.error ? (
        <div className="mt-4 flex items-center gap-3 px-1">
          <Banner>{humanError(inboxQuery.error)}</Banner>
          <Button variant="ghost" onClick={() => void inboxQuery.refetch()}>
            {t.inbox.retry}
          </Button>
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-4 px-1">
          <Banner>{actionError}</Banner>
        </div>
      ) : null}

      {inboxQuery.isLoading ? (
        <InboxSkeleton />
      ) : empty ? (
        filter === 'all' ? (
          <EmptyInbox />
        ) : (
          <p className="px-3 py-12 text-center text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {t.inbox.filterEmpty}
          </p>
        )
      ) : (
        <div role="list" aria-label={t.rail.capture} className="pb-8">
          {filter === 'all' && pending.length > 0 ? (
            <div className="pt-3">
              {pending.map((save) => (
                <PendingRow
                  key={save.id}
                  save={save}
                  disabled={!online || save.phase === 'processing'}
                  onRetry={() => {
                    void actions.retry(save).then((result) => {
                      if (result && 'id' in result) navigate(`/inbox/${result.id}`);
                    });
                  }}
                />
              ))}
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.key}>
              <p className="eyebrow eyebrow-rule px-3 pb-1.5 pt-5">
                {t.inbox.group[group.key]}
                <span className="font-mono normal-case tracking-normal tabular-nums opacity-80">
                  {group.items.length}
                </span>
              </p>
              {group.items.map((item) => (
                <SaveRow
                  key={item.id}
                  item={item}
                  timeZone={timeZone}
                  selected={selectedId === item.id}
                  compact
                  onFavorite={
                    online && canPatchStatus(item)
                      ? () => patchStatus(item.id, nextFavoriteStatus(item))
                      : undefined
                  }
                  onArchive={
                    online && canPatchStatus(item)
                      ? () => patchStatus(item.id, item.status === 'archived' ? 'unread' : 'archived')
                      : undefined
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
