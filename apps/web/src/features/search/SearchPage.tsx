import type { SearchHit } from '@vital/dto';
import { bindServices, useService } from '@rabjs/react';
import { useEffect, type FC } from 'react';
import { Link } from 'react-router';
import { t } from '@/copy';
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
  const q = page.query.trim();
  const items = q === '' ? null : page.result?.q === q ? page.result.items : null;
  const error = q === '' ? null : page.result?.q === q ? page.result.error : null;
  const loading = q !== '' && page.result?.q !== q;

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
        autoFocus
        type="search"
        value={page.query}
        onChange={(event) => page.setQuery(event.target.value)}
        placeholder={t.search.placeholder}
        aria-label={t.search.placeholder}
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
        <ul className="mt-6 flex flex-col gap-1">
          {(items ?? []).map((hit) => (
            <li key={hrefOf(hit)}>
              <Link
                to={hrefOf(hit)}
                className="flex min-h-[var(--touch-min)] items-center justify-between rounded-lg px-3 transition-[background-color] duration-[var(--ease-out)] hover:bg-surface-muted"
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
