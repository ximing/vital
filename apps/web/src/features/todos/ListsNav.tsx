import type { List } from '@vital/dto';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronRight, Folder, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { t } from '@/copy';
import { RAIL_NAV, railNavClass } from '@/shell/rail-nav';
import { listIdFrom, rhythmHref } from '@/shell/section';
import { pointAnchor, type MenuAnchor } from '@/ui/anchor-menu';
import { Icon } from '@/ui/icon';
import { ListContextMenu } from './ListContextMenu';
import { ListIconPopover } from './ListIconPopover';
import {
  countWithDescendants,
  listChildren,
  listRoots,
  userLists,
} from './model';
import { useCountsQuery, useListsQuery, useTodoActions } from './queries';

const FOLD_KEY = 'vital:list-folded';

function loadFolded(): Set<string> {
  try {
    const raw = localStorage.getItem(FOLD_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

function saveFolded(ids: Set<string>): void {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify([...ids]));
  } catch {
    // Private mode.
  }
}

const EMOJI_RE = /^(\p{Extended_Pictographic}(?:️|⃣)?(?:‍\p{Extended_Pictographic}️?)*)\s*/u;

function listBadge(list: List): { icon: string | null; name: string } {
  if (list.icon !== null && list.icon !== '') return { icon: list.icon, name: list.name };
  const match = EMOJI_RE.exec(list.name);
  if (match?.[1]) return { icon: match[1], name: list.name.slice(match[0].length) };
  return { icon: null, name: list.name };
}

export function ListGlyph({ list, fallback }: { list: List; fallback: LucideIcon }) {
  if (list.iconUrl) {
    return (
      <img
        src={list.iconUrl}
        alt=""
        className="h-4 w-4 shrink-0 rounded object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
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
  const { createList, patchList, deleteList } = useTodoActions();
  const navigate = useNavigate();
  const location = useLocation();
  const current = listIdFrom(location.pathname, location.search);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [childOf, setChildOf] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [folded, setFolded] = useState<Set<string>>(() => loadFolded());
  const [menu, setMenu] = useState<{ list: List; x: number; y: number } | null>(null);
  const [iconFor, setIconFor] = useState<{ list: List; anchor: MenuAnchor } | null>(null);
  const lists = data ?? [];
  const roots = listRoots(lists);

  function toggleFold(id: string) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFolded(next);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;
    try {
      const list = await createList.mutateAsync({
        name: trimmed,
        ...(childOf ? { parentId: childOf } : {}),
      });
      setName('');
      setOpen(false);
      setChildOf(null);
      if (childOf) {
        setFolded((prev) => {
          const next = new Set(prev);
          next.delete(childOf);
          saveFolded(next);
          return next;
        });
      }
      navigate(rhythmHref(list.id, location.pathname));
    } catch {
      // Keep the draft so the name can be retried.
    }
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed === '') {
      setRenamingId(null);
      return;
    }
    await patchList.mutateAsync({ id: renamingId, input: { name: trimmed } });
    setRenamingId(null);
  }

  function startChild(parentId: string) {
    setChildOf(parentId);
    setOpen(true);
    setName('');
  }

  function renderRow(list: List, depth: number) {
    const kids = listChildren(lists, list.id);
    const badge = listBadge(list);
    const expanded = !folded.has(list.id);
    const creatingHere = open && childOf === list.id;
    if (renamingId === list.id) {
      return (
        <form key={list.id} onSubmit={(e) => void submitRename(e)} className="px-3 py-1">
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => setRenamingId(null)}
            maxLength={80}
            aria-label={t.todos.renameList}
            className="h-[var(--control-h)] w-full rounded-md border border-border bg-surface px-2 text-[length:var(--text-meta)] text-fg"
          />
        </form>
      );
    }
    return (
      <div key={list.id}>
        <div
          className={`${railNavClass(current === list.id)} ${depth > 0 ? 'pl-6' : ''}`}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ list, x: event.clientX, y: event.clientY });
          }}
        >
          {kids.length > 0 ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? t.todos.more : t.todos.newChildList}
              className="-ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:text-fg"
              onClick={() => toggleFold(list.id)}
            >
              <Icon icon={expanded ? ChevronDown : ChevronRight} size={12} />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <button
            type="button"
            aria-label={t.todos.setListIcon}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-surface-muted"
            onClick={(event) => {
              event.stopPropagation();
              setIconFor({ list, anchor: event.currentTarget.getBoundingClientRect() });
            }}
          >
            <ListGlyph list={list} fallback={icon} />
          </button>
          <NavLink
            to={rhythmHref(list.id, location.pathname)}
            className="flex min-w-0 flex-1 items-center self-stretch"
          >
            <span className="min-w-0 flex-1 truncate">{badge.name}</span>
            <CountBadge value={countWithDescendants(counts, lists, list.id)} />
          </NavLink>
        </div>
        {expanded
          ? kids.map((child) => renderRow(child, depth + 1))
          : null}
        {creatingHere ? (
          <form onSubmit={(e) => void submit(e)} className="px-3 py-1 pl-6">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() === '') {
                  setOpen(false);
                  setChildOf(null);
                }
              }}
              placeholder={t.todos.newListPlaceholder}
              aria-label={t.todos.newListPlaceholder}
              maxLength={80}
              className="h-[var(--control-h)] w-full rounded-md border border-border bg-surface px-2 text-[length:var(--text-meta)] text-fg placeholder:text-muted"
            />
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {roots.map((list) => renderRow(list, 0))}
      {open && childOf === null ? (
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
          onClick={() => {
            setChildOf(null);
            setOpen(true);
          }}
        >
          <Icon icon={addIcon} className="shrink-0 opacity-80" />
          {t.todos.newList}
        </button>
      )}
      {menu ? (
        <ListContextMenu
          list={menu.list}
          lists={lists}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => {
            setRenamingId(menu.list.id);
            setRenameValue(menu.list.name);
          }}
          onIcon={() => setIconFor({ list: menu.list, anchor: pointAnchor(menu.x, menu.y) })}
          onNewChild={() => startChild(menu.list.id)}
          onMove={(parentId) => {
            void patchList.mutateAsync({ id: menu.list.id, input: { parentId } });
          }}
          onArchive={() => {
            void patchList.mutateAsync({ id: menu.list.id, input: { isArchived: true } });
          }}
          onDelete={() => {
            if (!window.confirm(t.todos.deleteListConfirm)) return;
            void deleteList.mutateAsync(menu.list.id).then(() => {
              if (current === menu.list.id) navigate('/todos/lists/smart:today');
            });
          }}
        />
      ) : null}
      {iconFor ? (
        <ListIconPopover
          list={iconFor.list}
          anchor={iconFor.anchor}
          onClose={() => setIconFor(null)}
          onPicked={() => setIconFor(null)}
        />
      ) : null}
    </div>
  );
}

/** Mockup-style favorite tiles: first few user lists as an emoji grid. */
export function ListShortcuts() {
  const { data } = useListsQuery();
  const location = useLocation();
  const lists = userLists(data ?? []).filter((item) => item.parentId === null).slice(0, 8);
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
            <ListGlyph list={list} fallback={Folder} />
            <span className="w-full truncate text-center text-[11px] leading-tight text-secondary">
              {badge.name}
            </span>
          </NavLink>
        );
      })}
    </div>
  );
}
