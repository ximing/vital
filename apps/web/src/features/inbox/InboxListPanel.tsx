import type { InboxItem } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { Plus } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type PointerEvent,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { t } from '@/copy';
import { useTagsQuery } from '@/features/todos';
import { humanError } from '@/lib/errors';
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
import { useScrollVirtualizer, virtualItemStyle } from '@/ui/use-scroll-virtualizer';
import { EmptyInbox, InboxSkeleton } from './EmptyInbox';
import { InboxContextMenu } from './InboxContextMenu';
import { InboxPageService } from './inbox-page.service';
import { PendingRow, SaveRow } from './InboxRow';
import {
  canPatchStatus,
  filterSaves,
  groupSavesByDay,
  nextFavoriteStatus,
  parseInboxFilter,
  parseInboxTagId,
  PASTE_URL_ID,
  type DayGroupKey,
  type PendingSave,
} from './model';
import { useOnline } from './online';
import { PasteUrl } from './PasteUrl';
import { useInboxActions, useInboxListQuery } from './queries';
import { InboxUiService } from './inbox-ui.service';

const POPOVER_W = 416;

type InboxVirtualRow =
  | { key: string; kind: 'pending'; save: PendingSave }
  | { key: string; kind: 'header'; groupKey: DayGroupKey; count: number }
  | { key: string; kind: 'item'; item: InboxItem };

function flattenInboxRows(
  pending: PendingSave[],
  groups: { key: DayGroupKey; items: InboxItem[] }[],
  filter: ReturnType<typeof parseInboxFilter>,
): InboxVirtualRow[] {
  const rows: InboxVirtualRow[] = [];
  if (filter === 'all') {
    for (const save of pending) {
      rows.push({ key: `p:${save.id}`, kind: 'pending', save });
    }
  }
  for (const group of groups) {
    rows.push({
      key: `g:${group.key}`,
      kind: 'header',
      groupKey: group.key,
      count: group.items.length,
    });
    for (const item of group.items) {
      rows.push({ key: `i:${item.id}`, kind: 'item', item });
    }
  }
  return rows;
}

function estimateInboxRow(row: InboxVirtualRow): number {
  if (row.kind === 'header') return 40;
  if (row.kind === 'pending') return 48;
  return 72;
}

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
export const InboxListPanel: FC<{ selectedId?: string }> = observer(function InboxListPanel({
  selectedId,
}) {
  const page = useService(InboxPageService);
  const inbox = useService(InboxUiService);
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const filter = parseInboxFilter(search.get('filter'));
  const tagId = parseInboxTagId(search.get('tag'));
  const online = useOnline();
  const timeZone = page.timeZone;
  const inboxQuery = useInboxListQuery();
  const tags = useTagsQuery().data ?? [];
  const actions = useInboxActions();
  const pending = inbox.pending;
  const pasteNonce = inbox.pasteNonce;
  const preview = inbox.preview;
  const pasteRef = useRef<HTMLDivElement>(null);
  const pasteBtnRef = useRef<HTMLButtonElement>(null);
  const pastePopover = usePopover(pasteRef);
  const [pasteAnchor, setPasteAnchor] = useState<{ right: number; top: number } | null>(null);
  const actionError = page.actionError;
  const statusNote = page.statusNote;
  const menu = page.itemMenu;

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
  const items = filterSaves(all, filter, tagId);
  const unreadCount = filterSaves(all, 'unread', tagId).length;
  const totalCount = filterSaves(all, 'all', tagId).length;
  const activeTag = tags.find((tag) => tag.id === tagId);
  const menuItem = menu ? (all.find((item) => item.id === menu.item.id) ?? menu.item) : null;
  const rows = useMemo(
    () =>
      flattenInboxRows(pending, groupSavesByDay(filterSaves(all, filter, tagId), timeZone), filter),
    [pending, all, filter, tagId, timeZone],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const { listRef, virtualizer } = useScrollVirtualizer({ rows, estimateSize: estimateInboxRow });
  const scrollToSelected = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedId || rows.length === 0) return;
    if (scrollToSelected.current === selectedId) return;
    const index = rowsRef.current.findIndex(
      (row) => row.kind === 'item' && row.item.id === selectedId,
    );
    if (index < 0) return;
    scrollToSelected.current = selectedId;
    virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [selectedId, rows.length, virtualizer]);

  const summary = `${totalCount} ${t.inbox.unit} · ${unreadCount} ${t.inbox.unread}`;
  const empty =
    items.length === 0 && pending.length === 0 && !inboxQuery.isLoading && inboxQuery.error === null;

  function patchStatus(id: string, status: 'later' | 'unread' | 'archived'): void {
    page.setActionError(null);
    void actions.patch.mutateAsync({ id, input: { status } }).catch((err) => {
      page.setActionError(humanError(err));
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
          {activeTag ? ` · #${activeTag.name}` : ''}
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

      {statusNote ? (
        <p role="status" className="mt-3 px-3 text-[length:var(--text-meta)] text-muted">
          {statusNote}
        </p>
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
        <div ref={listRef} role="list" aria-label={t.rail.capture} className="pb-8">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={row.kind === 'pending' && virtualRow.index === 0 ? 'pt-3' : undefined}
                  style={virtualItemStyle(virtualRow.start, virtualizer.options.scrollMargin)}
                >
                  {row.kind === 'pending' ? (
                    <PendingRow
                      save={row.save}
                      disabled={!online || row.save.phase === 'processing'}
                      onRetry={() => {
                        void actions.retry(row.save).then((result) => {
                          if (result && 'id' in result) navigate(`/inbox/${result.id}`);
                        });
                      }}
                    />
                  ) : row.kind === 'header' ? (
                    <p className="eyebrow eyebrow-rule px-3 pb-1.5 pt-5">
                      {t.inbox.group[row.groupKey]}
                      <span className="font-mono normal-case tracking-normal tabular-nums opacity-80">
                        {row.count}
                      </span>
                    </p>
                  ) : (
                    <SaveRow
                      item={row.item}
                      tags={tags}
                      timeZone={timeZone}
                      selected={selectedId === row.item.id}
                      compact
                      onFavorite={
                        online && canPatchStatus(row.item)
                          ? () => patchStatus(row.item.id, nextFavoriteStatus(row.item))
                          : undefined
                      }
                      onArchive={
                        online && canPatchStatus(row.item)
                          ? () =>
                              patchStatus(
                                row.item.id,
                                row.item.status === 'archived' ? 'unread' : 'archived',
                              )
                          : undefined
                      }
                      onContextMenu={(event) => {
                        event.preventDefault();
                        page.openItemMenu(row.item, event.clientX, event.clientY);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {menu && menuItem ? (
        <InboxContextMenu
          item={menuItem}
          tags={tags}
          x={menu.x}
          y={menu.y}
          disabled={!online}
          onClose={() => page.closeItemMenu()}
          onOpen={() => navigate(`/inbox/${menuItem.id}`)}
          onFavorite={() => patchStatus(menuItem.id, nextFavoriteStatus(menuItem))}
          onArchive={() =>
            patchStatus(menuItem.id, menuItem.status === 'archived' ? 'unread' : 'archived')
          }
          onConvert={() => {
            void page.convertKeepUrl(menuItem.id).catch((err) => {
              page.setActionError(humanError(err));
            });
          }}
          onExportInwit={() => {
            void page.exportToInwit(menuItem.id).catch((err) => {
              page.setActionError(humanError(err));
            });
          }}
          onCopyUrl={() => {
            if (!menuItem.originalUrl) return;
            void navigator.clipboard.writeText(menuItem.originalUrl).catch(() => {
              // Clipboard unavailable.
            });
          }}
          onAddToReport={() => page.setStatusNote(t.inbox.addToReportStub)}
          onPatchTags={(tagIds) => {
            page.setActionError(null);
            void actions.patch.mutateAsync({ id: menuItem.id, input: { tagIds } }).catch((err) => {
              page.setActionError(humanError(err));
            });
          }}
          onCreateTag={(name) => actions.createTag.mutateAsync(name)}
          onDelete={() => {
            if (!window.confirm(t.inbox.deleteItemConfirm)) return;
            void actions.remove
              .mutateAsync(menuItem.id)
              .then(() => {
                if (selectedId === menuItem.id) navigate('/inbox');
              })
              .catch((err) => {
                page.setActionError(humanError(err));
              });
          }}
        />
      ) : null}
    </div>
  );
});
