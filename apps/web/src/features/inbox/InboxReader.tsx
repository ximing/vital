import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { useTodosUi } from '@/features/todos/ui-store';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { EmptyReader, InboxSkeleton } from './EmptyInbox';
import { canPatchStatus, isFavorite, nextFavoriteStatus, READER_SIZES } from './model';
import { useOnline } from './online';
import { useInboxActions, useInboxItemQuery } from './queries';
import { ReaderArticle } from './ReaderArticle';
import { useInboxUi } from './ui-store';

export function InboxReader() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
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
        useTodosUi.getState().openDetail(res.task.id);
      }
    } catch (err) {
      setActionError(humanError(err));
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-[var(--z-sticky)] border-b border-border bg-canvas/95 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="quiet" className="px-2" onClick={() => navigate('/inbox')}>
            {t.inbox.back}
          </Button>
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="quiet"
              disabled={!online || !patchable}
              onClick={() => void onArchive()}
            >
              {item?.status === 'archived' ? t.inbox.unarchive : t.inbox.archive}
            </Button>
            <Button
              variant="quiet"
              disabled={!online || !patchable}
              aria-pressed={item ? isFavorite(item) : false}
              onClick={() => void onFavorite()}
            >
              {item && isFavorite(item) ? t.inbox.unfavorite : t.inbox.favorite}
            </Button>
            <Button
              variant="quiet"
              disabled={!online || converted || !item}
              onClick={() => void onConvert()}
            >
              {converted ? t.inbox.converted : t.inbox.convert}
            </Button>
            <Button variant="quiet" onClick={() => setReportHint(true)}>
              {t.inbox.addToReport}
            </Button>
          </div>
          <div
            className="ml-auto flex rounded-md bg-surface p-0.5"
            role="group"
            aria-label={t.inbox.fontSize}
          >
            {READER_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={fontSize === size}
                aria-label={t.inbox.font[size]}
                className={`min-h-[var(--touch-min)] rounded-md px-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] ${
                  fontSize === size ? 'bg-accent-subtle text-fg' : 'text-muted hover:text-fg'
                }`}
                onClick={() => setFontSize(size)}
              >
                {t.inbox.font[size]}
              </button>
            ))}
          </div>
        </div>
      </header>

      {!online ? (
        <div className="px-4 pt-3">
          <Banner>{t.todos.offline}</Banner>
        </div>
      ) : null}

      {query.error ? (
        <div className="flex items-center gap-3 px-4 py-3">
          <Banner>{humanError(query.error)}</Banner>
          <Button variant="ghost" onClick={() => void query.refetch()}>
            {t.inbox.retry}
          </Button>
        </div>
      ) : null}

      {actionError ? (
        <div className="px-4 pt-3">
          <Banner>{actionError}</Banner>
        </div>
      ) : null}

      {reportHint ? (
        <p
          role="status"
          className="px-4 pt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
        >
          {t.inbox.addToReportStub}
        </p>
      ) : null}

      {convertNote ? (
        <p
          role="status"
          className="px-4 pt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
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

      <div className="mx-auto w-full max-w-[42rem] flex-1 px-4 py-8">
        {query.isLoading ? (
          <InboxSkeleton />
        ) : !item ? (
          <EmptyReader />
        ) : (
          <>
            <h1 className="text-[length:var(--text-display)] font-semibold leading-[var(--text-display-lh)] tracking-[-0.03em]">
              {item.title}
            </h1>
            <p className="mt-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)]">
              <span className="text-muted">{t.inbox.originalUrl} · </span>
              {originalUrl ? (
                <a
                  href={originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-accent underline-offset-4 hover:underline"
                >
                  {originalUrl}
                </a>
              ) : (
                <span className="text-muted">{t.inbox.noOriginalUrl}</span>
              )}
            </p>
            {item.byline || item.siteName ? (
              <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
                {[item.byline, item.siteName].filter(Boolean).join(' · ')}
              </p>
            ) : null}
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
    </div>
  );
}
