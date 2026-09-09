import { Link } from 'react-router';
import { t } from '@/copy';
import { useInboxListQuery } from '@/features/inbox/queries';
import { inboxSourceIcon, inboxSourceTextClass } from '@/features/inbox/InboxRow';
import { Icon } from '@/ui/icon';

/** Inbox materials attached to the filtered thread, shown above the task list. */
export function OutcomeMaterials({ outcomeId }: { outcomeId: string }) {
  const inboxQuery = useInboxListQuery();
  const items = (inboxQuery.data ?? []).filter(
    (item) => item.outcomeId === outcomeId && item.deletedAt === null,
  );
  if (items.length === 0) return null;

  return (
    <div
      data-region="outcome-materials"
      className="mt-2.5 rounded-lg border border-border bg-surface px-4 py-2"
    >
      <div className="py-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-tertiary">
        {t.today.materialsLabel.replace('{n}', String(items.length))}
      </div>
      {items.map((item) => (
        <Link
          key={item.id}
          to={`/inbox/${item.id}`}
          className="group flex items-center gap-2 py-1.5 text-[length:var(--text-meta)]"
        >
          <Icon
            icon={inboxSourceIcon(item.source)}
            size={13}
            className={`shrink-0 ${inboxSourceTextClass(item.source)}`}
          />
          <span className="min-w-0 truncate text-muted transition-colors group-hover:text-fg">
            {item.title}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-tertiary">
            {t.inbox.source[item.source]}
          </span>
        </Link>
      ))}
    </div>
  );
}
