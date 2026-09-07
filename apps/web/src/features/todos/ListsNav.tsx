import type { List } from '@vital/dto';
import type { LucideIcon } from 'lucide-react';
import { Folder, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { t } from '@/copy';
import { RAIL_NAV, railNavClass } from '@/shell/rail-nav';
import { listIdFrom, rhythmHref } from '@/shell/section';
import { Icon } from '@/ui/icon';
import { userLists } from './model';
import { useCountsQuery, useListsQuery, useTodoActions } from './queries';

const EMOJI_RE = /^(\p{Extended_Pictographic}(?:️|⃣)?(?:‍\p{Extended_Pictographic}️?)*)\s*/u;

/** Leading emoji (or list.icon) doubles as the row icon; stripped from the label. */
function listBadge(list: List): { icon: string | null; name: string } {
  if (list.icon !== null && list.icon !== '') return { icon: list.icon, name: list.name };
  const match = EMOJI_RE.exec(list.name);
  if (match?.[1]) return { icon: match[1], name: list.name.slice(match[0].length) };
  return { icon: null, name: list.name };
}

function ListGlyph({ list, fallback }: { list: List; fallback: LucideIcon }) {
  const { icon } = listBadge(list);
  if (icon !== null) {
    return (
      <span aria-hidden className="w-4 shrink-0 text-center text-[14px] leading-none">
        {icon}
      </span>
    );
  }
  return <Icon icon={fallback} className="shrink-0 opacity-80" />;
}

function CountBadge({ value }: { value: number | undefined }) {
  if (!value) return null;
  return (
    <span className="ml-auto shrink-0 pl-2 text-[length:var(--text-caption)] tabular-nums text-tertiary">
      {value > 99 ? '99+' : value}
    </span>
  );
}

export function UserListsNav({
  icon = Folder,
  addIcon = Plus,
}: {
  icon?: LucideIcon;
  addIcon?: LucideIcon;
}) {
  const { data } = useListsQuery();
  const counts = useCountsQuery().data ?? {};
  const { createList } = useTodoActions();
  const navigate = useNavigate();
  const location = useLocation();
  const current = listIdFrom(location.pathname, location.search);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const lists = userLists(data ?? []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;
    try {
      const list = await createList.mutateAsync({ name: trimmed });
      setName('');
      setOpen(false);
      navigate(`/todos/lists/${list.id}`);
    } catch {
      // Keep the draft so the name can be retried.
    }
  }

  return (
    <div>
      {lists.map((list) => (
        <NavLink
          key={list.id}
          to={rhythmHref(list.id, location.pathname)}
          className={railNavClass(current === list.id)}
        >
          <ListGlyph list={list} fallback={icon} />
          <span className="min-w-0 flex-1 truncate">{listBadge(list).name}</span>
          <CountBadge value={counts[list.id]} />
        </NavLink>
      ))}
      {open ? (
        <form onSubmit={(e) => void submit(e)} className="px-3 py-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() === '') setOpen(false);
            }}
            placeholder={t.todos.newListPlaceholder}
            aria-label={t.todos.newListPlaceholder}
            maxLength={80}
            className="h-[var(--control-h)] w-full rounded-md border border-border bg-surface px-2 text-[length:var(--text-meta)] text-fg placeholder:text-muted"
          />
        </form>
      ) : (
        <button
          type="button"
          className={`${RAIL_NAV} w-full text-left text-muted hover:bg-surface-muted hover:text-fg`}
          onClick={() => setOpen(true)}
        >
          <Icon icon={addIcon} className="shrink-0 opacity-80" />
          {t.todos.newList}
        </button>
      )}
    </div>
  );
}

/** Mockup-style favorite tiles: first few user lists as an emoji grid. */
export function ListShortcuts() {
  const { data } = useListsQuery();
  const location = useLocation();
  const lists = userLists(data ?? []).slice(0, 8);
  if (lists.length < 2) return null;
  const current = listIdFrom(location.pathname, location.search);
  return (
    <div className="grid grid-cols-4 gap-0.5 px-2 pb-2 pt-1">
      {lists.map((list) => {
        const badge = listBadge(list);
        return (
          <NavLink
            key={list.id}
            to={rhythmHref(list.id, location.pathname)}
            title={badge.name}
            className={`flex min-w-0 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 ${
              current === list.id ? 'bg-accent-subtle' : 'hover:bg-surface-muted'
            }`}
          >
            {badge.icon !== null ? (
              <span aria-hidden className="text-[17px] leading-none">
                {badge.icon}
              </span>
            ) : (
              <span
                aria-hidden
                className="flex h-[17px] w-[17px] items-center justify-center rounded bg-accent-subtle text-[11px] font-medium text-fg"
              >
                {badge.name.trim().charAt(0) || '·'}
              </span>
            )}
            <span className="w-full truncate text-center text-[11px] leading-tight text-secondary">
              {badge.name}
            </span>
          </NavLink>
        );
      })}
    </div>
  );
}
