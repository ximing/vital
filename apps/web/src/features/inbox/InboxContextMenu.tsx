import type { InboxItem, Tag } from '@vital/dto';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Check,
  Copy,
  FilePlus2,
  ListTodo,
  Star,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@/copy';
import { FIELD_POPOVER_CLASS } from '@/ui/field';
import { Icon } from '@/ui/icon';
import { canPatchStatus, isFavorite } from './model';

function Item({
  label,
  icon,
  danger = false,
  active = false,
  filled = false,
  disabled = false,
  onSelect,
}: {
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  active?: boolean;
  filled?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[length:var(--text-caption)] disabled:opacity-40 ${
        danger ? 'text-danger hover:bg-surface-muted' : 'text-fg hover:bg-surface-muted'
      }`}
      onClick={onSelect}
    >
      <Icon
        icon={icon}
        size={14}
        className={`shrink-0 opacity-80 ${active ? 'text-accent' : ''}`}
        fill={filled ? 'currentColor' : 'none'}
      />
      {label}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 my-1 h-px bg-border/60" />;
}

export function InboxContextMenu({
  item,
  tags,
  x,
  y,
  disabled = false,
  onClose,
  onOpen,
  onFavorite,
  onArchive,
  onConvert,
  onCopyUrl,
  onAddToReport,
  onPatchTags,
  onCreateTag,
  onDelete,
}: {
  item: InboxItem;
  tags: Tag[];
  x: number;
  y: number;
  disabled?: boolean;
  onClose: () => void;
  onOpen: () => void;
  onFavorite: () => void;
  onArchive: () => void;
  onConvert: () => void;
  onCopyUrl: () => void;
  onAddToReport: () => void;
  onPatchTags: (tagIds: string[]) => void;
  onCreateTag: (name: string) => Promise<Tag | void>;
  onDelete: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [draft, setDraft] = useState('');
  const [tagIds, setTagIds] = useState(item.tagIds ?? []);
  const patchable = canPatchStatus(item);
  const converted = item.status === 'converted';
  const favorited = isFavorite(item);
  const archived = item.status === 'archived';

  useEffect(() => {
    setTagIds(item.tagIds ?? []);
  }, [item]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y, tags.length, tagIds.length]);

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

  function toggleTag(id: string) {
    const next = tagIds.includes(id) ? tagIds.filter((itemId) => itemId !== id) : [...tagIds, id];
    setTagIds(next);
    onPatchTags(next);
  }

  async function addTag(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (name === '' || disabled) return;
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!tagIds.includes(existing.id)) toggleTag(existing.id);
      setDraft('');
      return;
    }
    const created = await onCreateTag(name);
    setDraft('');
    if (!created) return;
    const next = tagIds.includes(created.id) ? tagIds : [...tagIds, created.id];
    setTagIds(next);
    onPatchTags(next);
  }

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
        aria-label={item.title}
        style={{ left: pos.left, top: pos.top }}
        className={`fixed w-56 ${FIELD_POPOVER_CLASS} p-1.5`}
        onClick={(event) => event.stopPropagation()}
      >
        <Item icon={BookOpen} label={t.inbox.openItem} onSelect={act(onOpen)} />
        {patchable ? (
          <Item
            icon={Star}
            label={favorited ? t.inbox.unfavorite : t.inbox.favorite}
            active={favorited}
            filled={favorited}
            disabled={disabled}
            onSelect={act(onFavorite)}
          />
        ) : null}
        {patchable ? (
          <Item
            icon={archived ? ArchiveRestore : Archive}
            label={archived ? t.inbox.unarchive : t.inbox.archive}
            disabled={disabled}
            onSelect={act(onArchive)}
          />
        ) : null}
        <Item
          icon={ListTodo}
          label={converted ? t.inbox.converted : t.inbox.convert}
          active={converted}
          disabled={disabled || converted}
          onSelect={act(onConvert)}
        />
        {item.originalUrl ? (
          <Item icon={Copy} label={t.inbox.copyLink} onSelect={act(onCopyUrl)} />
        ) : null}
        <Item icon={FilePlus2} label={t.inbox.addToReport} onSelect={act(onAddToReport)} />
        <Divider />
        <p className="flex items-center gap-1.5 px-2 pb-1 pt-1.5 text-[length:var(--text-caption)] text-tertiary">
          <Icon icon={TagIcon} size={12} />
          {t.inbox.tags}
        </p>
        {tags.length > 0 ? (
          <div className="max-h-36 overflow-y-auto">
            {tags.map((tag) => {
              const on = tagIds.includes(tag.id);
              return (
                <Item
                  key={tag.id}
                  icon={on ? Check : TagIcon}
                  label={`#${tag.name}`}
                  active={on}
                  disabled={disabled}
                  onSelect={() => toggleTag(tag.id)}
                />
              );
            })}
          </div>
        ) : null}
        <form className="px-1 pb-1 pt-0.5" onSubmit={(event) => void addTag(event)}>
          <input
            className="h-7 w-full rounded-md border border-dashed border-border bg-transparent px-2 text-[length:var(--text-caption)] text-fg outline-none placeholder:text-muted focus:border-focus"
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t.todos.addTag}
            aria-label={t.todos.addTag}
            maxLength={40}
          />
        </form>
        <Divider />
        <Item
          icon={Trash2}
          label={t.inbox.deleteItem}
          danger
          disabled={disabled}
          onSelect={act(onDelete)}
        />
      </div>
    </div>
  );
}
