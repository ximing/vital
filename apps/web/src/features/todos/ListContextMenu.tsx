import type { List } from '@vital/dto';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  Folder,
  FolderInput,
  FolderPlus,
  ImagePlus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '@/copy';
import { clampCursorMenu } from '@/ui/anchor-menu';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { listChildren, listRoots } from './model';

function Item({
  label,
  icon,
  danger = false,
  onSelect,
}: {
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[length:var(--text-caption)] ${
        danger ? 'text-danger hover:bg-surface-muted' : 'text-fg hover:bg-surface-muted'
      }`}
      onClick={onSelect}
    >
      <Icon icon={icon} size={14} className="shrink-0 opacity-80" />
      {label}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 my-1 h-px bg-border/60" />;
}

export function ListContextMenu({
  list,
  lists,
  x,
  y,
  onClose,
  onRename,
  onIcon,
  onNewChild,
  onMove,
  onArchive,
  onDelete,
}: {
  list: List;
  lists: List[];
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onIcon: () => void;
  onNewChild: () => void;
  onMove: (parentId: string | null) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => ({ left: x, top: y }));
  const children = listChildren(lists, list.id);
  const roots = listRoots(lists).filter((item) => item.id !== list.id);
  const canNestUnder = children.length === 0;
  const showMove = list.parentId !== null || (canNestUnder && roots.length > 0);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(clampCursorMenu(x, y, rect.width, rect.height));
  }, [x, y]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)]"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={list.name}
        style={{ left: pos.left, top: pos.top }}
        className={`fixed w-52 ${FIELD_POPOVER_CLASS} p-1.5`}
        onClick={(event) => event.stopPropagation()}
      >
        <Item icon={Pencil} label={t.todos.renameList} onSelect={act(onRename)} />
        <Item icon={ImagePlus} label={t.todos.setListIcon} onSelect={act(onIcon)} />
        {list.parentId === null ? (
          <Item icon={FolderPlus} label={t.todos.newChildList} onSelect={act(onNewChild)} />
        ) : null}
        {showMove ? (
          <>
            <Divider />
            <p className="flex items-center gap-2 px-2 pb-1 pt-1.5 text-[length:var(--text-caption)] text-tertiary">
              <Icon icon={FolderInput} size={12} />
              {t.todos.moveListTo}
            </p>
            {list.parentId !== null ? (
              <Item icon={Folder} label={t.todos.moveListToRoot} onSelect={act(() => onMove(null))} />
            ) : null}
            {canNestUnder
              ? roots.map((item) => (
                  <Item
                    key={item.id}
                    icon={Folder}
                    label={item.name}
                    onSelect={act(() => onMove(item.id))}
                  />
                ))
              : null}
          </>
        ) : null}
        <Divider />
        <Item icon={Archive} label={t.todos.archiveList} onSelect={act(onArchive)} />
        <Item icon={Trash2} label={t.todos.deleteList} danger onSelect={act(onDelete)} />
      </div>
    </div>
  );
}
