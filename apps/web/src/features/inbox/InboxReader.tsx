import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  FilePlus2,
  ListTodo,
  Star,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { todosUi } from '@/features/todos/todos-ui.service';
import { humanError } from '@/lib/errors';
import { useAuth } from '@/services/auth.service';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Icon, type LucideIcon } from '@/ui/icon';
import { EmptyReader, InboxSkeleton } from './EmptyInbox';
import { inboxSourceIcon, inboxSourceTextClass } from './InboxRow';
import {
  canPatchStatus,
  formatCapturedAt,
  hostLabel,
  isFavorite,
  nextFavoriteStatus,
  READER_SIZES,
} from './model';
import { useOnline } from './online';
import { useInboxActions, useInboxItemQuery } from './queries';
import { ReaderArticle } from './ReaderArticle';
import { useInboxUi } from './inbox-ui.service';

const CONTENT_WIDTH = 'mx-auto w-full max-w-[64rem] px-8';

function ActionButton({
  label,
  icon,
  active = false,
  activeClass = '',
  disabled = false,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  activeClass?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-[background-color,color] duration-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? activeClass : 'text-muted hover:bg-surface-muted hover:text-fg'
      }`}
    >
      <Icon icon={icon} size={15} />
    </button>
  );
}

export function InboxReader() {
  const { id = '' } = useParams();
  const online = useOnline();
  const timeZone = useAuth((s) => s.user?.timezone) ?? 'UTC';
  const query = useInboxItemQuery(id);
  const actions = useInboxActions();
  const fontSize = useInboxUi((s) => s.fontSize);
  const setFontSize = useInboxUi((s) => s.setFontSize);
  const [reportHint, setReportHint] = useState(false);
  const [convertNote, setConvertNote] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const item = query.data;
  const refetchItem = query.refetch;
  const markedRead = useRef<string | null>(null);

  useEffect(() => {
    if (!item || item.readAt !== null || markedRead.current === item.id) return;
    markedRead.current = item.id;
    void client
      .patchInbox(item.id, { readAt: new Date().toISOString() })
      .then(() => refetchItem())
      .catch(() => {
        // Read receipt is best-effort.
      });
  }, [item, refetchItem]);

  const originalUrl = item?.originalUrl ?? null;
  const patchable = item ? canPatchStatus(item) : false;
  const converted = item?.status === 'converted';

  async function onFavorite() {
    if (!item || !patchable) return;
    setActionError(null);
    try {
      await actions.patch.mutateAsync({
        id: item.id,
        input: { status: nextFavoriteStatus(item) },
      });
    } catch (err) {
      setActionError(humanError(err));
    }
  }

  async function onArchive() {
    if (!item || !patchable) return;
    setActionError(null);
    try {
      await actions.patch.mutateAsync({
        id: item.id,
        input: { status: item.status === 'archived' ? 'unread' : 'archived' },
      });
    } catch (err) {
      setActionError(humanError(err));
    }
  }

  async function onConvert() {
    if (!item || converted) return;
    setActionError(null);
    try {
      const res = await actions.convertKeepUrl(item.id);
      setConvertNote(t.inbox.convertKeptUrl);
      if (res.task.id) {
        todosUi().openDetail(res.task.id);
      }
    } catch (err) {
      setActionError(humanError(err));
    }
  }

  return (
    <main id="main" data-region="reading-canvas" className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-canvas">
      <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-canvas/90 backdrop-blur-sm">
        <div className={`${CONTENT_WIDTH} flex h-12 items-center gap-3`}>
          {item ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
              <Icon
                icon={inboxSourceIcon(item.source)}
                size={13}
                className={`shrink-0 ${inboxSourceTextClass(item.source)}`}
              />
              <span className="min-w-0 truncate">
                {[
                  hostLabel(item.originalUrl) ?? item.siteName,
                  formatCapturedAt(item.capturedAt, timeZone),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          ) : null}
          <div
            className="ml-auto flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
            role="group"
            aria-label={t.inbox.actions}
          >
            <ActionButton
              label={item?.status === 'archived' ? t.inbox.unarchive : t.inbox.archive}
              icon={item?.status === 'archived' ? ArchiveRestore : Archive}
              disabled={!online || !patchable}
              onClick={() => void onArchive()}
            />
            <ActionButton
              label={item && isFavorite(item) ? t.inbox.unfavorite : t.inbox.favorite}
              icon={Star}
              active={item ? isFavorite(item) : false}
              activeClass="bg-due/12 text-due"
              disabled={!online || !patchable}
              onClick={() => void onFavorite()}
            />
            <ActionButton
              label={converted ? t.inbox.converted : t.inbox.convert}
              icon={ListTodo}
              active={converted}
              activeClass="bg-done/12 text-done"
              disabled={!online || converted || !item}
              onClick={() => void onConvert()}
            />
            <ActionButton
              label={t.inbox.addToReport}
              icon={FilePlus2}
              onClick={() => setReportHint(true)}
            />
            <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
            <div role="group" aria-label={t.inbox.fontSize} className="flex items-center gap-0.5">
              {READER_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={fontSize === size}
                  aria-label={t.inbox.font[size]}
                  className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] transition-[background-color,color] duration-[var(--ease-out)] ${
                    fontSize === size
                      ? 'bg-accent-subtle text-fg'
                      : 'text-muted hover:bg-surface-muted hover:text-fg'
                  }`}
                  onClick={() => setFontSize(size)}
                >
                  {t.inbox.font[size]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {!online ? (
        <div className={`${CONTENT_WIDTH} pt-3`}>
          <Banner>{t.todos.offline}</Banner>
        </div>
      ) : null}

      {query.error ? (
        <div className={`${CONTENT_WIDTH} flex items-center gap-3 py-3`}>
          <Banner>{humanError(query.error)}</Banner>
          <Button variant="ghost" onClick={() => void query.refetch()}>
            {t.inbox.retry}
          </Button>
        </div>
      ) : null}

      {actionError ? (
        <div className={`${CONTENT_WIDTH} pt-3`}>
          <Banner>{actionError}</Banner>
        </div>
      ) : null}

      {reportHint ? (
        <p
          role="status"
          className={`${CONTENT_WIDTH} pt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted`}
        >
          {t.inbox.addToReportStub}
        </p>
      ) : null}

      {convertNote ? (
        <p
          role="status"
          className={`${CONTENT_WIDTH} pt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted`}
        >
          {convertNote}{' '}
          <Link
            to="/todos/lists/smart:inbox"
            className="text-accent underline-offset-4 hover:underline"
          >
            {t.inbox.openTask}
          </Link>
        </p>
      ) : null}

      <div className="reader-progress w-full" aria-hidden="true" />
      <div className={`${CONTENT_WIDTH} flex-1 py-10`}>
        {query.isLoading ? (
          <InboxSkeleton />
        ) : !item ? (
          <EmptyReader />
        ) : (
          <>
            <h1 className="text-[length:var(--text-display)] font-semibold leading-[var(--text-display-lh)] tracking-[-0.03em]">
              {item.title}
            </h1>
            {originalUrl ? (
              <p className="mt-3 flex items-center gap-1.5 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)]">
                <span className="shrink-0 text-muted">{t.inbox.originalUrl} · </span>
                <a
                  href={originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-baseline gap-1 break-all text-accent underline-offset-4 hover:underline"
                >
                  {originalUrl}
                  <Icon icon={ArrowUpRight} size={12} className="shrink-0 self-center" />
                </a>
              </p>
            ) : null}
            <p className="mt-1.5 flex items-center gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
              <Icon
                icon={inboxSourceIcon(item.source)}
                size={13}
                className={`shrink-0 ${inboxSourceTextClass(item.source)}`}
              />
              {[t.inbox.source[item.source], item.byline, item.siteName].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-8">
              <ReaderArticle
                html={item.extractedHtml}
                text={item.extractedText}
                assets={item.assets}
                size={fontSize}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
