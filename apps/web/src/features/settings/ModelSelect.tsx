import { useId, useRef, useState } from 'react';
import { Field, FIELD_POPOVER_CLASS } from '@/ui/field';
import { usePopover } from '@/ui/use-popover';
import { t } from '@/copy';

export function ModelSelect({
  options,
  value,
  onChange,
}: {
  options: { id: string; name: string }[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const popover = usePopover(root);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const term = query.trim();
  const matches = options.filter(
    (option) =>
      !value.includes(option.id) &&
      `${option.id} ${option.name}`.toLowerCase().includes(term.toLowerCase()),
  );
  const choices = [...matches];
  if (term && !value.includes(term) && !options.some((option) => option.id === term)) {
    choices.push({ id: term, name: `添加“${term}”` });
  }

  function add(id: string) {
    if (!value.includes(id)) onChange([...value, id]);
    setQuery('');
    setActive(-1);
    popover.close();
  }

  return (
    <div ref={root} className="relative">
      <Field
        label={t.settings.llm.providerModels}
        name="providerModels"
        role="combobox"
        aria-expanded={popover.open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          popover.open && active >= 0 && choices[active] ? `${listId}-${active}` : undefined
        }
        value={query}
        maxLength={128}
        placeholder="选择模型，或输入模型 ID 后按 Enter 添加"
        autoComplete="off"
        spellCheck={false}
        onFocus={() => popover.setOpen(true)}
        onClick={() => popover.setOpen(true)}
        onBlur={(event) => {
          if (!root.current?.contains(event.relatedTarget)) popover.close();
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(-1);
          popover.setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            popover.setOpen(true);
            setActive((previous) =>
              choices.length === 0
                ? -1
                : event.key === 'ArrowDown'
                  ? Math.min(previous + 1, choices.length - 1)
                  : Math.max(previous - 1, 0),
            );
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const selected = popover.open && active >= 0 ? choices[active]?.id : term;
            if (selected) add(selected);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            popover.close();
          }
        }}
      />
      {popover.open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t.settings.llm.providerModels}
          className={`absolute z-[var(--z-dropdown)] mt-1 max-h-56 w-full overflow-auto ${FIELD_POPOVER_CLASS}`}
        >
          {choices.map((option, index) => (
            <button
              key={option.id}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={active === index}
              className={`block w-full rounded-md px-2.5 py-2 text-left text-[length:var(--text-meta)] hover:bg-surface-muted ${active === index ? 'bg-accent-subtle' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(option.id)}
            >
              {option.name}
              {option.name !== option.id && !option.name.startsWith('添加“')
                ? ` · ${option.id}`
                : ''}
            </button>
          ))}
          {choices.length === 0 ? (
            <p className="text-sm text-muted">输入模型 ID 后按 Enter 添加</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {value.map((id) => (
          <button
            key={id}
            type="button"
            aria-label={`移除模型 ${id}`}
            className="rounded-full bg-accent-subtle px-3 py-1 text-[length:var(--text-caption)] text-accent-deep"
            onClick={() => onChange(value.filter((model) => model !== id))}
          >
            {id} ×
          </button>
        ))}
      </div>
    </div>
  );
}
