import { Archive, CircleDot, Hash, Inbox as InboxIcon, Star } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import { t } from '@/copy';
import {
  filterSaves,
  inboxHref,
  parseInboxFilter,
  parseInboxTagId,
  type InboxFilter,
} from '@/features/inbox/model';
import { useInboxListQuery } from '@/features/inbox/queries';
import { useTagsQuery } from '@/features/todos/queries';
import { railNavClass } from '@/shell/rail-nav';
import { Icon, type LucideIcon } from '@/ui/icon';

const FILTERS: { key: InboxFilter; icon: LucideIcon }[] = [
  { key: 'all', icon: InboxIcon },
  { key: 'unread', icon: CircleDot },
  { key: 'favorite', icon: Star },
  { key: 'archived', icon: Archive },
];

/** Library pane for /inbox: the list lives on the canvas; here is only the index. */
export function CapturePane() {
  const location = useLocation();
  const inboxQuery = useInboxListQuery();
  const tagsQuery = useTagsQuery();
  const items = inboxQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const onInbox = location.pathname === '/inbox' || location.pathname.startsWith('/inbox/');
  const params = new URLSearchParams(location.search);
  const current = parseInboxFilter(params.get('filter'));
  const tagId = parseInboxTagId(params.get('tag'));
  const usedTags = tags.filter((tag) =>
    items.some((item) => item.deletedAt === null && (item.tagIds ?? []).includes(tag.id)),
  );

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
      {FILTERS.map(({ key, icon }) => {
        const count = filterSaves(items, key, tagId).length;
        return (
          <NavLink key={key} to={inboxHref(key, tagId)} className={railNavClass(onInbox && current === key)}>
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
      {usedTags.length > 0 ? (
        <>
          <p className="eyebrow eyebrow-rule px-3 pb-1 pt-5">{t.inbox.tags}</p>
          {usedTags.map((tag) => {
            const active = tagId === tag.id;
            const count = filterSaves(items, current, tag.id).length;
            return (
              <NavLink
                key={tag.id}
                to={inboxHref(current, active ? null : tag.id)}
                className={railNavClass(onInbox && active)}
                aria-label={active ? t.inbox.clearTag : `#${tag.name}`}
              >
                <Icon icon={Hash} className="shrink-0 opacity-80" />
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                {count ? (
                  <span className="ml-auto shrink-0 pl-2 font-mono text-[length:var(--text-caption)] tabular-nums text-tertiary">
                    {count > 99 ? '99+' : count}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </>
      ) : null}
    </nav>
  );
}
