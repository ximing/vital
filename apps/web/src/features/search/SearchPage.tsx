import type { SearchHit } from '@vital/dto';
import { bindServices, useService } from '@rabjs/react';
import { useEffect, useState, type FC, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { t } from '@/copy';
import {
  isComposingEvent,
  isShortcutLayerBlocked,
  isTypingTarget,
  SEARCH_INPUT_ID,
} from '@/shell/shortcut-guard';
import { Banner } from '@/ui/banner';
import { EmptyArt } from '@/ui/empty-art';
import { SearchPageService } from './search-page.service';

function hrefOf(hit: SearchHit): string {
  if (hit.type === 'task') return `/todos/lists/${hit.task.listId}?task=${hit.task.id}`;
  if (hit.type === 'inbox') return `/inbox/${hit.inbox.id}`;
  return `/reports/${hit.report.id}?type=${hit.report.type}`;
}

function titleOf(hit: SearchHit): string {
  if (hit.type === 'task') return hit.task.title;
  if (hit.type === 'inbox') return hit.inbox.title;
  return hit.report.title;
}

function kindOf(hit: SearchHit): string {
  if (hit.type === 'task') return t.palette.task;
  if (hit.type === 'inbox') return t.palette.inbox;
  return t.palette.report;
}

function SearchPageContent() {
  const page = useService(SearchPageService);
  const navigate = useNavigate();
  const q = page.query.trim();
  const items = q === '' ? null : page.result?.q === q ? page.result.items : null;
  const error = q === '' ? null : page.result?.q === q ? page.result.error : null;
  const loading = q !== '' && page.result?.q !== q;
  const [active, setActive] = useState(0);
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setActive(0);
  }
  const hits = items ?? [];
  const current = hits.length === 0 ? 0 : Math.min(active, hits.length - 1);

  useEffect(() => {
    if (q === '') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) void page.search(q);
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, page]);

  function openHit(index: number): void {
    const hit = hits[index];
    if (!hit) return;
    navigate(hrefOf(hit));
  }

  function moveHit(delta: 1 | -1): void {
    if (hits.length === 0) return;
    setActive((index) => {
      const base = Math.min(index, hits.length - 1);
      return Math.min(hits.length - 1, Math.max(0, base + delta));
    });
  }

  function onInputKey(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (isComposingEvent(event.nativeEvent)) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHit(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHit(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      openHit(current);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (page.query !== '') page.setQuery('');
      else event.currentTarget.blur();
    }
  }

  useEffect(() => {
    const list = items ?? [];
    function onKey(event: KeyboardEvent): void {
      if (isComposingEvent(event) || isShortcutLayerBlocked()) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (list.length === 0) return;
      const index = Math.min(current, list.length - 1);
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setActive(Math.min(list.length - 1, index + 1));
        return;
      }
      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActive(Math.max(0, index - 1));
        return;
      }
      if (event.key === 'Enter' || event.key === 'ArrowRight') {
        const hit = list[index];
        if (!hit) return;
        event.preventDefault();
        navigate(hrefOf(hit));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, items, navigate]);

  const empty = q === '' || items === null;

  return (
    <div data-region="search-canvas" className="h-full min-h-0 w-full overflow-y-auto px-6 py-12">
      <div className="mx-auto w-full max-w-2xl">
      <EmptyArt />
      <h1 className="font-display text-[length:var(--text-display)] font-bold leading-[var(--text-display-lh)]">
        {t.nav.search}
      </h1>
      <p className="mt-2 text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-muted">
        {t.empty.search}
      </p>
      <input
        id={SEARCH_INPUT_ID}
        autoFocus
        type="search"
        value={page.query}
        onChange={(event) => page.setQuery(event.target.value)}
        onKeyDown={onInputKey}
        placeholder={t.search.placeholder}
        aria-label={t.search.placeholder}
        aria-activedescendant={hits[current] ? `search-hit-${current}` : undefined}
        aria-controls="search-hits"
        className="mt-6 h-11 w-full rounded-[14px] border border-border bg-surface px-4 text-fg shadow-[var(--shadow-xs)] placeholder:text-muted outline-none focus:border-focus focus:shadow-[0_0_0_3px_var(--focus-ring)]"
      />
      {error ? (
        <div className="mt-4">
          <Banner>{error}</Banner>
        </div>
      ) : null}
      {loading ? (
        <p className="mt-4 text-[length:var(--text-meta)] text-muted" aria-busy="true">
          {t.search.loading}
        </p>
      ) : null}
      {empty && !loading ? null : !loading && items && items.length === 0 ? (
        <p className="mt-6 text-[length:var(--text-body)] text-muted">{t.empty.searchNone}</p>
      ) : (
        <ul id="search-hits" role="listbox" aria-label={t.nav.search} className="mt-6 flex flex-col gap-1">
          {hits.map((hit, index) => (
            <li key={hrefOf(hit)} role="presentation">
              <Link
                id={`search-hit-${index}`}
                to={hrefOf(hit)}
                role="option"
                aria-selected={index === current}
                className={`flex min-h-[var(--touch-min)] items-center justify-between rounded-lg px-3 transition-[background-color] duration-[var(--ease-out)] ${
                  index === current ? 'bg-accent-subtle' : 'hover:bg-surface-muted'
                }`}
                onMouseEnter={() => setActive(index)}
              >
                <span className="font-medium">{titleOf(hit)}</span>
                <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[length:var(--text-caption)] font-medium text-accent">{kindOf(hit)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}

export const SearchPage: FC = bindServices(SearchPageContent, [SearchPageService]);
