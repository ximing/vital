import type { LucideIcon } from 'lucide-react';
import { Folder, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { t } from '@/copy';
import { Icon } from '@/ui/icon';
import { userLists } from './model';
import { useListsQuery, useTodoActions } from './queries';

const NAV_BASE =
  'relative flex min-h-[var(--touch-min)] items-center gap-2 px-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] transition-[color,background-color] duration-[var(--ease-out)]';

function navClass({ isActive }: { isActive: boolean }): string {
  return `${NAV_BASE} ${
    isActive
      ? "bg-accent-subtle text-fg before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-accent before:content-['']"
      : 'text-muted hover:bg-surface-muted hover:text-fg'
  }`;
}

export function UserListsNav({
  icon = Folder,
  addIcon = Plus,
}: {
  icon?: LucideIcon;
  addIcon?: LucideIcon;
}) {
  const { data } = useListsQuery();
  const { createList } = useTodoActions();
  const navigate = useNavigate();
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
        <NavLink key={list.id} to={`/todos/lists/${list.id}`} className={navClass}>
          <Icon icon={icon} className="shrink-0 opacity-80" />
          <span className="truncate">{list.name}</span>
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
          className={`${NAV_BASE} w-full text-left text-muted hover:bg-surface-muted hover:text-fg`}
          onClick={() => setOpen(true)}
        >
          <Icon icon={addIcon} className="shrink-0 opacity-80" />
          {t.todos.newList}
        </button>
      )}
    </div>
  );
}
