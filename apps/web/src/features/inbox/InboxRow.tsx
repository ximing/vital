import type { InboxItem, InboxSource, Task } from '@vital/dto';
import {
  Archive,
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
import { TaskCheckbox } from '@/features/todos/TaskRow';
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
      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${SOURCE_TILE_CLASS[source]}`}
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
      ? 'bg-due/12 text-due'
      : status === 'converted'
        ? 'bg-done/12 text-done'
        : 'bg-surface-muted text-tertiary';
  return (
    <span
      className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-px text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] ${tone}`}
    >
      <Icon icon={glyph} size={11} />
      {t.inbox[status]}
    </span>
  );
}

export function UnprocessedRow({
  task,
  timeZone,
  onOpen,
  onComplete,
}: {
  task: Task;
  timeZone: string;
  onOpen: () => void;
  onComplete: () => void;
}) {
  return (
    <div
      role="listitem"
      className="flex min-h-[var(--touch-min)] cursor-pointer items-start gap-3 rounded-md px-3 py-2 transition-[background-color] duration-[var(--ease-out)] hover:bg-surface-muted"
      onClick={onOpen}
    >
      <TaskCheckbox task={task} timeZone={timeZone} onToggle={onComplete} />
      <p className="min-w-0 flex-1 truncate text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-fg">
        {task.title}
      </p>
    </div>
  );
}

export function SaveRow({
  item,
  timeZone,
  selected = false,
}: {
  item: InboxItem;
  timeZone: string;
  selected?: boolean;
}) {
  const host = hostLabel(item.originalUrl) ?? item.siteName;
  const when = formatCapturedAt(item.capturedAt, timeZone);
  const status = statusLabelKey(item.status);
  const unread = item.readAt === null && item.status === 'unread';
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
            className={`min-w-0 flex-1 truncate text-[length:var(--text-body)] leading-[var(--text-body-lh)] ${
              unread ? 'font-medium text-fg' : 'text-secondary'
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
            <Icon icon={Star} size={12} className="mt-[3px] shrink-0 text-due" aria-label={t.inbox.favorite} />
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
          {host ? <span className="min-w-0 truncate">{host}</span> : null}
          {host ? (
            <span aria-hidden="true" className="shrink-0 text-tertiary">
              ·
            </span>
          ) : null}
          <span className="shrink-0 tabular-nums">{when}</span>
          {status !== 'unread' && status !== 'favorite' ? <StatusChip status={status} /> : null}
        </span>
        {item.excerpt ? (
          <span className="mt-1 line-clamp-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
            {item.excerpt}
          </span>
        ) : null}
      </span>
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
