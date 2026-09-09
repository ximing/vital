import type { Tag } from '@vital/dto';
import { useState, type FormEvent } from 'react';
import { t } from '@/copy';

export function InboxTagEditor({
  tagIds,
  tags,
  disabled = false,
  onChange,
  onCreate,
}: {
  tagIds: string[];
  tags: Tag[];
  disabled?: boolean;
  onChange: (tagIds: string[]) => void;
  onCreate: (name: string) => Promise<Tag | void>;
}) {
  const [draft, setDraft] = useState('');
  const selected = tags.filter((tag) => tagIds.includes(tag.id));

  function toggle(id: string) {
    onChange(tagIds.includes(id) ? tagIds.filter((item) => item !== id) : [...tagIds, id]);
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (name === '' || disabled) return;
    const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!tagIds.includes(existing.id)) onChange([...tagIds, existing.id]);
      setDraft('');
      return;
    }
    const created = await onCreate(name);
    if (created && !tagIds.includes(created.id)) onChange([...tagIds, created.id]);
    setDraft('');
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((tag) => (
        <button
          key={tag.id}
          type="button"
          disabled={disabled}
          className="h-6 rounded-full bg-accent-subtle px-2.5 text-[length:var(--text-caption)] font-medium text-accent transition-opacity duration-[var(--ease-out)] hover:opacity-75 disabled:opacity-40"
          onClick={() => toggle(tag.id)}
        >
          #{tag.name}
        </button>
      ))}
      <form onSubmit={(event) => void add(event)}>
        <input
          className="h-6 w-28 rounded-full border border-dashed border-border bg-transparent px-2.5 text-[length:var(--text-caption)] text-fg outline-none transition-[background-color,border-color] duration-[var(--ease-out)] placeholder:text-muted hover:border-tertiary/50 focus:border-focus focus:bg-surface disabled:opacity-40"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t.todos.addTag}
          aria-label={t.todos.addTag}
          maxLength={40}
        />
      </form>
    </div>
  );
}
