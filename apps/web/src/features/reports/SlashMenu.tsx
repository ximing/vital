import { useEffect, useMemo, useState } from 'react';
import { t } from '@/copy';
import type { SlashHit, SlashQuery } from './model';
import { searchSlashHits } from './queries';

export function SlashMenu({
  slash,
  onPick,
  onClose,
}: {
  slash: SlashQuery;
  onPick: (hit: SlashHit) => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<{ query: string; hits: SlashHit[] } | null>(null);
  const hits = useMemo(
    () => (result?.query === slash.query ? result.hits : []),
    [result, slash.query],
  );
  const loading = result?.query !== slash.query;
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchSlashHits(slash.query)
        .then((next) => {
          if (cancelled) return;
          setResult({ query: slash.query, hits: next });
          setActive(0);
        })
        .catch(() => {
          if (!cancelled) setResult({ query: slash.query, hits: [] });
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slash.query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (hits.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((i) => (i + 1) % hits.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((i) => (i - 1 + hits.length) % hits.length);
        return;
      }
      if (event.key === 'Enter') {
        const hit = hits[active];
        if (!hit) return;
        event.preventDefault();
        event.stopPropagation();
        onPick(hit);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, hits, onClose, onPick]);

  return (
    <div
      className="absolute left-0 right-0 top-full z-[var(--z-dropdown)] mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-[var(--shadow)]"
      role="listbox"
      aria-label={t.reports.slashHint}
    >
      {loading && hits.length === 0 ? (
        <p className="px-3 py-2 text-[length:var(--text-meta)] text-muted">{t.reports.loading}</p>
      ) : hits.length === 0 ? (
        <p className="px-3 py-2 text-[length:var(--text-meta)] text-muted">
          {t.reports.slashEmpty}
        </p>
      ) : (
        hits.map((hit, index) => (
          <button
            key={`${hit.kind}:${hit.id}`}
            type="button"
            role="option"
            aria-selected={index === active}
            className={`flex min-h-[var(--touch-min)] w-full items-center gap-2 px-3 text-left text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] ${
              index === active ? 'bg-accent-subtle text-fg' : 'text-fg hover:bg-surface-muted'
            }`}
            onMouseEnter={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(hit)}
          >
            <span className="text-muted">
              {hit.kind === 'task' ? t.reports.pinTask : t.reports.pinInbox}
            </span>
            <span className="truncate">{hit.title}</span>
          </button>
        ))
      )}
    </div>
  );
}
