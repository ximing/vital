import { Archive, CircleDot, Inbox as InboxIcon, Star } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { t } from '@/copy';
import { filterSaves, parseInboxFilter, type InboxFilter } from '@/features/inbox/model';
import { useInboxListQuery } from '@/features/inbox/queries';
import { railNavClass } from '@/shell/rail-nav';
import { Icon, type LucideIcon } from '@/ui/icon';

const FILTERS: { key: InboxFilter; icon: LucideIcon; href: string }[] = [
  { key: 'all', icon: InboxIcon, href: '/inbox' },
  { key: 'unread', icon: CircleDot, href: '/inbox?filter=unread' },
  { key: 'favorite', icon: Star, href: '/inbox?filter=favorite' },
  { key: 'archived', icon: Archive, href: '/inbox?filter=archived' },
];

/** Library pane for /inbox: the list lives on the canvas; here is only the index. */
export function CapturePane() {
  const location = useLocation();
  const inboxQuery = useInboxListQuery();
  const items = inboxQuery.data ?? [];
  const onInbox = location.pathname === '/inbox' || location.pathname.startsWith('/inbox/');
  const current = parseInboxFilter(new URLSearchParams(location.search).get('filter'));

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
      {FILTERS.map(({ key, icon, href }) => {
        const count = filterSaves(items, key).length;
        return (
          <NavLink key={key} to={href} className={railNavClass(onInbox && current === key)}>
            <Icon icon={icon} className="shrink-0 opacity-80" />
            <span className="min-w-0 flex-1 truncate">{t.inbox.filters[key]}</span>
            {count ? (
              <span className="ml-auto shrink-0 pl-2 font-mono text-[length:var(--text-caption)] tabular-nums text-tertiary">
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
