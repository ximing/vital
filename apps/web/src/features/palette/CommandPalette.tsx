import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { markOnboarding } from '@/features/onboarding/mark';
import { useListsQuery } from '@/features/todos/queries';
import {
  commandItems,
  filterItems,
  hitsToItems,
  isPaletteToggle,
  listItems,
  mergePalette,
  type PaletteItem,
} from './model';

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ q: string; hits: PaletteItem[] } | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listsQuery = useListsQuery();

  const commands = useMemo(
    () => [...commandItems(), ...listItems(listsQuery.data ?? [])],
    [listsQuery.data],
  );
  const filtered = useMemo(() => filterItems(commands, query), [commands, query]);
  const q = query.trim();
  const items = useMemo(
    () => mergePalette(filtered, q === '' || result?.q !== q ? [] : result.hits),
    [filtered, q, result],
  );
  const safeActive = items.length === 0 ? 0 : Math.min(active, items.length - 1);
  const activeItem = items[safeActive];

  function close(): void {
    setOpen(false);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (!isPaletteToggle(event)) return;
      event.preventDefault();
      if (open) {
        setOpen(false);
        return;
      }
      setQuery('');
      setResult(null);
      setActive(0);
      setOpen(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open || q === '') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void client
        .search({ q, limit: 20 })
        .then((res) => {
          if (!cancelled) setResult({ q, hits: hitsToItems(res.items) });
        })
        .catch(() => {
          if (!cancelled) setResult({ q, hits: [] });
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, q]);

  const go = useCallback(
    (item: PaletteItem): void => {
      if (item.href.includes('type=weekly')) void markOnboarding({ openedWeekly: true });
      close();
      navigate(item.href);
    },
    [navigate],
  );

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (items.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((i) => (i + 1) % items.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (event.key === 'Enter') {
        const item = items[safeActive];
        if (!item) return;
        event.preventDefault();
        go(item);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go, items, open, safeActive]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-overlay)] flex items-start justify-center bg-[color:var(--scrim)] px-4 pt-[15vh]"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.nav.palette}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          placeholder={t.palette.placeholder}
          aria-label={t.palette.placeholder}
          className="h-[var(--control-h-prominent)] w-full border-b border-border bg-transparent px-4 text-fg outline-none placeholder:text-muted"
        />
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
          {items.length === 0 ? (
            <li className="px-4 py-3 text-[length:var(--text-meta)] text-muted">{t.palette.empty}</li>
          ) : (
            items.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === activeItem?.id}
                  className={`flex min-h-[var(--touch-min)] w-full items-center justify-between px-4 text-left text-[length:var(--text-meta)] ${
                    item.id === activeItem?.id ? 'bg-accent-subtle text-fg' : 'text-fg hover:bg-surface-muted'
                  }`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(item)}
                >
                  <span>{item.title}</span>
                  <span className="text-[length:var(--text-caption)] text-muted">{item.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
