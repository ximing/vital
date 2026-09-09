import type { InboxItem, InboxSource } from '@vital/dto';
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  CircleAlert,
  Globe,
  LoaderCircle,
  MessageCircle,
  PenLine,
  Smartphone,
  Star,
} from 'lucide-react';
import { Link } from 'react-router';
import { t } from '@/copy';
import { Button } from '@/ui/button';
import { Icon, type LucideIcon } from '@/ui/icon';
import { formatCapturedAt, hostLabel, statusLabelKey, type PendingSave } from './model';

const SOURCE_ICONS: Record<InboxSource, LucideIcon> = {
  extension: Bookmark,
  wechat: MessageCircle,
  web: Globe,
  mobile: Smartphone,
  manual: PenLine,
};

export function inboxSourceIcon(source: InboxSource): LucideIcon {
  return SOURCE_ICONS[source];
}

const SOURCE_TILE_CLASS: Record<InboxSource, string> = {
  extension: 'bg-src-extension/15 text-src-extension',
  wechat: 'bg-src-wechat/15 text-src-wechat',
  web: 'bg-src-web/15 text-src-web',
  mobile: 'bg-src-mobile/15 text-src-mobile',
  manual: 'bg-src-manual/15 text-src-manual',
};

const SOURCE_TEXT_CLASS: Record<InboxSource, string> = {
  extension: 'text-src-extension',
  wechat: 'text-src-wechat',
  web: 'text-src-web',
  mobile: 'text-src-mobile',
  manual: 'text-src-manual',
};

export function inboxSourceTextClass(source: InboxSource): string {
  return SOURCE_TEXT_CLASS[source];
}

function SourceTile({ source }: { source: InboxSource }) {
  return (
    <span
      className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${SOURCE_TILE_CLASS[source]}`}
      title={t.inbox.source[source]}
    >
      <Icon icon={SOURCE_ICONS[source]} size={13} />
      <span className="sr-only">{t.inbox.source[source]}</span>
    </span>
  );
}

function StatusChip({ status }: { status: 'favorite' | 'archived' | 'converted' }) {
  const glyph = status === 'favorite' ? Star : Archive;
  const tone =
    status === 'favorite'
      ? 'bg-favorite/12 text-favorite'
      : status === 'converted'
        ? 'bg-done/12 text-done'
        : 'bg-surface-muted text-tertiary';
  return (
    <span
      className={`mt-px inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] ${tone}`}
    >
      <Icon icon={glyph} size={11} />
      {t.inbox[status]}
    </span>
  );
}

export function SaveRow({
  item,
  timeZone,
  selected = false,
  compact = false,
  onFavorite,
  onArchive,
}: {
  item: InboxItem;
  timeZone: string;
  selected?: boolean;
  compact?: boolean;
  onFavorite?: () => void;
  onArchive?: () => void;
}) {
  const host = hostLabel(item.originalUrl) ?? item.siteName;
  const when = formatCapturedAt(item.capturedAt, timeZone);
  const status = statusLabelKey(item.status);
  const unread = item.readAt === null && item.status === 'unread';
  const archived = item.status === 'archived';
  return (
    <Link
      to={`/inbox/${item.id}`}
      data-density="reading-row"
      className={`group relative mx-1 flex gap-2.5 rounded-lg px-3 py-2.5 transition-[background-color] duration-[var(--ease-out)] ${
        selected ? 'bg-surface-muted' : 'hover:bg-surface-muted'
      }`}
    >
      {selected ? (
        <span aria-hidden="true" className="absolute inset-y-2.5 left-0.5 w-[3px] rounded-full bg-accent" />
      ) : null}
      <SourceTile source={item.source} />
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[length:var(--text-body)] font-semibold leading-[var(--text-body-lh)] ${
              unread ? 'text-fg' : 'text-secondary'
            }`}
          >
            {item.title}
          </span>
          {unread ? (
            <span
              aria-label={t.inbox.unread}
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
            />
          ) : null}
          {status === 'favorite' ? (
            <Icon
              icon={Star}
              size={12}
              fill="currentColor"
              className="mt-[3px] shrink-0 text-favorite"
              aria-label={t.inbox.favorite}
            />
          ) : null}
          {status !== 'unread' && status !== 'favorite' ? <StatusChip status={status} /> : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {host ? <span className="min-w-0 truncate">{host}</span> : null}
          {host ? (
            <span aria-hidden="true" className="shrink-0 text-tertiary">
              ·
            </span>
          ) : null}
          <span className="ml-auto shrink-0 pl-2 font-mono tabular-nums text-tertiary">{when}</span>
        </span>
        {item.excerpt ? (
          <span
            className={`mt-[3px] text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted ${
              compact ? 'line-clamp-1' : 'line-clamp-2'
            }`}
          >
            {item.excerpt}
          </span>
        ) : null}
      </span>
      {onFavorite || onArchive ? (
        <span className="absolute right-2 top-2 hidden gap-0.5 rounded-md border border-border bg-elevated p-0.5 shadow-[var(--shadow-xs)] group-hover:flex">
          {onFavorite ? (
            <button
              type="button"
              aria-label={status === 'favorite' ? t.inbox.unfavorite : t.inbox.favorite}
              title={status === 'favorite' ? t.inbox.unfavorite : t.inbox.favorite}
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-accent-subtle hover:text-accent"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onFavorite();
              }}
            >
              <Icon icon={Star} size={13} />
            </button>
          ) : null}
          {onArchive ? (
            <button
              type="button"
              aria-label={archived ? t.inbox.unarchive : t.inbox.archive}
              title={archived ? t.inbox.unarchive : t.inbox.archive}
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-accent-subtle hover:text-accent"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onArchive();
              }}
            >
              <Icon icon={archived ? ArchiveRestore : Archive} size={13} />
            </button>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}

export function PendingRow({
  save,
  onRetry,
  disabled,
}: {
  save: PendingSave;
  onRetry: () => void;
  disabled?: boolean;
}) {
  const processing = save.phase === 'processing';
  return (
    <div
      role="status"
      className="flex min-h-[var(--touch-min)] items-center justify-between gap-3 rounded-md px-3 py-2"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
            processing ? 'bg-canvas text-muted' : 'bg-danger/10 text-danger'
          }`}
        >
          <Icon
            icon={processing ? LoaderCircle : CircleAlert}
            size={14}
            className={processing ? 'animate-spin' : undefined}
          />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-fg">
            {save.url || t.inbox.pasteUrl}
          </p>
          <p
            className={`mt-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] ${
              processing ? 'text-muted' : 'text-danger'
            }`}
          >
            {processing ? t.inbox.processing : (save.error ?? t.inbox.failed)}
          </p>
        </div>
      </div>
      {processing ? null : (
        <Button variant="ghost" disabled={disabled} onClick={onRetry}>
          {t.inbox.retry}
        </Button>
      )}
    </div>
  );
}
