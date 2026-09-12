import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Check,
  ChevronLeft,
  Copy,
  FilePlus2,
  ListTodo,
  Star,
} from 'lucide-react';
import { bindServices, useService } from '@rabjs/react';
import { useEffect, useRef, useState, type FC, type UIEvent } from 'react';
import { Link, useParams } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { useOutcomesQuery } from '@/features/today/queries';
import { useTagsQuery } from '@/features/todos/queries';
import { humanError } from '@/lib/errors';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { Icon, type LucideIcon } from '@/ui/icon';
import { OutcomeField } from '@/ui/outcome-field';
import { EmptyReader, InboxSkeleton } from './EmptyInbox';
import { InboxListColumn } from './InboxListPanel';
import { inboxSourceIcon, inboxSourceTextClass } from './InboxRow';
import {
  canPatchStatus,
  formatCapturedAt,
  hostLabel,
  isFavorite,
  nextFavoriteStatus,
  READER_SIZES,
} from './model';
import { InboxTagEditor } from './InboxTags';
import { useOnline } from './online';
import { InboxPageService } from './inbox-page.service';
import { useInboxActions, useInboxItemQuery } from './queries';
import { ReaderArticle } from './ReaderArticle';
import { InboxUiService } from './inbox-ui.service';

const CONTENT_WIDTH = 'mx-auto w-full max-w-[700px] px-8 xl:max-w-[840px] 2xl:max-w-[920px]';

function ActionButton({
  label,
  icon,
  active = false,
  activeClass = '',
  filled = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  activeClass?: string;
  filled?: boolean;
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
      <Icon icon={icon} size={15} fill={filled ? 'currentColor' : 'none'} />
    </button>
  );
}

function InboxReaderContent() {
  const page = useService(InboxPageService);
  const inbox = useService(InboxUiService);
  const { id = '' } = useParams();
  const online = useOnline();
  const timeZone = page.timeZone;
  const query = useInboxItemQuery(id);
  const tags = useTagsQuery().data ?? [];
  const outcomes = useOutcomesQuery().data ?? [];
  const actions = useInboxActions();
  const fontSize = inbox.fontSize;
  const [reportHint, setReportHint] = useState(false);
  const [convertNote, setConvertNote] = useState<string | null>(null);
  const actionError = page.actionError;

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
  const [readProgress, setReadProgress] = useState(0);
  const [copied, setCopied] = useState(false);

  async function onCopyUrl(): Promise<void> {
    if (!originalUrl) return;
    try {
      await navigator.clipboard.writeText(originalUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions / insecure context).
    }
  }

  function onScroll(event: UIEvent<HTMLElement>): void {
    const el = event.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    setReadProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
  }

  async function onFavorite() {
    if (!item || !patchable) return;
    page.setActionError(null);
    try {
      await actions.patch.mutateAsync({
        id: item.id,
        input: { status: nextFavoriteStatus(item) },
      });
    } catch (err) {
      page.setActionError(humanError(err));
    }
  }

  async function onArchive() {
    if (!item || !patchable) return;
    page.setActionError(null);
    try {
      await actions.patch.mutateAsync({
        id: item.id,
        input: { status: item.status === 'archived' ? 'unread' : 'archived' },
      });
    } catch (err) {
      page.setActionError(humanError(err));
    }
  }

  async function onConvert() {
    if (!item || converted) return;
    try {
      const res = await page.convertKeepUrl(item.id);
      setConvertNote(t.inbox.convertKeptUrl);
      if (res.task.id) page.openConvertedTask(res.task.id);
    } catch (err) {
      page.setActionError(humanError(err));
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 bg-canvas">
      <InboxListColumn selectedId={id} className="hidden lg:flex" />
      <main
        id="main"
        data-region="reading-canvas"
        onScroll={onScroll}
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-canvas"
      >
      <div className="sticky top-0 z-[var(--z-sticky)] h-[2px] w-full shrink-0" aria-hidden="true">
        <div
          className="h-full bg-accent transition-[width] duration-[var(--ease-in)]"
          style={{ width: `${readProgress * 100}%` }}
        />
      </div>
      <header className="sticky top-[2px] z-[var(--z-sticky)] bg-canvas/90 backdrop-blur-sm">
        <div className={`${CONTENT_WIDTH} flex h-12 items-center gap-3`}>
          <Link
            to="/inbox"
            className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          >
            <Icon icon={ChevronLeft} size={13} />
            {t.inbox.back}
          </Link>
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
              activeClass="bg-favorite/12 text-favorite"
              filled={item ? isFavorite(item) : false}
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
                  onClick={() => inbox.setFontSize(size)}
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

      <div className={`${CONTENT_WIDTH} flex-1 pb-16 pt-5`}>
        {query.isLoading ? (
          <InboxSkeleton />
        ) : !item ? (
          <EmptyReader />
        ) : (
          <>
            <h1 className="font-display text-[length:var(--text-display)] font-semibold leading-[var(--text-display-lh)] tracking-[-0.03em]">
              {item.title}
            </h1>
            <p className="mt-2 flex items-center gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
              <Icon
                icon={inboxSourceIcon(item.source)}
                size={13}
                className={`shrink-0 ${inboxSourceTextClass(item.source)}`}
              />
              <span className="shrink-0">
                {[t.inbox.source[item.source], item.byline, item.siteName].filter(Boolean).join(' · ')}
              </span>
              {originalUrl ? (
                <>
                  <span aria-hidden className="shrink-0">
                    ·
                  </span>
                  <a
                    href={originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-w-0 items-baseline gap-1 text-accent underline-offset-4 hover:underline"
                  >
                    <span className="min-w-0 truncate">{originalUrl}</span>
                    <Icon icon={ArrowUpRight} size={12} className="shrink-0 self-center" />
                  </a>
                  <button
                    type="button"
                    aria-label={copied ? t.inbox.copied : t.inbox.copyLink}
                    title={copied ? t.inbox.copied : t.inbox.copyLink}
                    onClick={() => void onCopyUrl()}
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-[background-color,color] duration-[var(--ease-out)] ${
                      copied
                        ? 'text-done'
                        : 'text-tertiary hover:bg-surface-muted hover:text-fg'
                    }`}
                  >
                    <Icon icon={copied ? Check : Copy} size={13} />
                  </button>
                </>
              ) : null}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <OutcomeField
                value={item.outcomeId}
                outcomes={outcomes}
                placeholder={t.inbox.attachOutcome}
                disabled={!online}
                onChange={(outcomeId) => {
                  page.setActionError(null);
                  void actions.patch
                    .mutateAsync({ id: item.id, input: { outcomeId } })
                    .catch((err) => {
                      page.setActionError(humanError(err));
                    });
                }}
              />
              <InboxTagEditor
                tagIds={item.tagIds ?? []}
                tags={tags}
                disabled={!online}
                onChange={(tagIds) => {
                  page.setActionError(null);
                  void actions.patch.mutateAsync({ id: item.id, input: { tagIds } }).catch((err) => {
                    page.setActionError(humanError(err));
                  });
                }}
                onCreate={(name) => actions.createTag.mutateAsync(name)}
              />
            </div>
            {item.extractedHtml || item.extractedText || item.assets.length > 0 ? (
              <div className="mt-7">
                <ReaderArticle
                  html={item.extractedHtml}
                  text={item.extractedText}
                  assets={item.assets}
                  size={fontSize}
                />
              </div>
            ) : (
              <p className="mt-3 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
                {t.inbox.noBody}
              </p>
            )}
          </>
        )}
      </div>
      </main>
    </div>
  );
}

export const InboxReader: FC = bindServices(InboxReaderContent, [InboxPageService]);
