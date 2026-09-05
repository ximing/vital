import type { InboxItem, Task } from '@vital/dto';
import { Link } from 'react-router';
import { t } from '@/copy';
import { TaskCheckbox } from '@/features/todos/TaskRow';
import { Button } from '@/ui/button';
import { formatCapturedAt, hostLabel, statusLabelKey, type PendingSave } from './model';

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

export function SaveRow({ item, timeZone }: { item: InboxItem; timeZone: string }) {
  const host = hostLabel(item.originalUrl) ?? item.siteName;
  const when = formatCapturedAt(item.capturedAt, timeZone);
  const status = statusLabelKey(item.status);
  return (
    <Link
      to={`/inbox/${item.id}`}
      className="flex min-h-[var(--touch-min)] flex-col rounded-md px-3 py-2 transition-[background-color] duration-[var(--ease-out)] hover:bg-surface-muted"
    >
      <span className="truncate text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-fg">
        {item.title}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
        {host ? <span>{host}</span> : null}
        <span>{when}</span>
        {status !== 'unread' ? <span>{t.inbox[status]}</span> : null}
      </span>
      {item.excerpt ? (
        <span className="mt-1 line-clamp-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
          {item.excerpt}
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
      className="flex min-h-[var(--touch-min)] items-start justify-between gap-3 rounded-md px-3 py-2"
    >
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
      {processing ? null : (
        <Button variant="ghost" disabled={disabled} onClick={onRetry}>
          {t.inbox.retry}
        </Button>
      )}
    </div>
  );
}
