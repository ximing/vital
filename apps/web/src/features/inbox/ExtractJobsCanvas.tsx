import type { ExtractJobListItem } from '@vital/dto';
import { observer, useService } from '@rabjs/react';
import { ChevronLeft } from 'lucide-react';
import type { FC } from 'react';
import { Link, useSearchParams } from 'react-router';
import { t } from '@/copy';
import { humanError } from '@/lib/errors';
import { Button } from '@/ui/button';
import { Icon } from '@/ui/icon';
import { Tip } from '@/ui/tip';
import { InboxPageService } from './inbox-page.service';
import {
  EXTRACT_JOB_PAGE_SIZE,
  formatCapturedAt,
  inboxListPath,
  jobLinkLabel,
  jobWhen,
  parseJobPage,
} from './model';
import { useInboxExtractJobsQuery } from './queries';

const CONTENT_WIDTH = 'mx-auto w-full max-w-[700px] px-8 xl:max-w-[840px] 2xl:max-w-[920px]';

function jobErrorLabel(code: string | null): string {
  if (code === 'EXTRACT_EMPTY') return t.inbox.jobs.error.empty;
  if (code === 'VALIDATION_ERROR') return t.inbox.jobs.error.rejected;
  return t.inbox.jobs.error.failed;
}

function JobRows({ items, timeZone }: { items: ExtractJobListItem[]; timeZone: string }) {
  return (
    <ul>
      {items.map((item) => {
        const when = jobWhen(item);
        const failed = item.status === 'failed';
        return (
          <li key={item.id} className="border-b border-border py-4 last:border-b-0">
            <Tip label={item.url}>
              <p className="truncate text-[length:var(--text-body)] leading-[var(--text-body-lh)] text-fg">
                {jobLinkLabel(item.url)}
              </p>
            </Tip>
            <p className="mt-1 font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] tabular-nums text-tertiary">
              <span className={failed ? 'text-danger' : undefined}>
                {t.inbox.jobs.status[item.status]}
              </span>
              {failed ? (
                <span className="text-danger"> · {jobErrorLabel(item.errorCode)}</span>
              ) : null}
              {when ? <span> · {formatCapturedAt(when, timeZone)}</span> : null}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export const ExtractJobsCanvas: FC = observer(function ExtractJobsCanvas() {
  const pageService = useService(InboxPageService);
  const [search, setSearch] = useSearchParams();
  const page = parseJobPage(search.get('page'));
  const query = useInboxExtractJobsQuery(page);
  const data = query.data;
  const timeZone = pageService.timeZone;
  const pageSize = data?.pageSize ?? EXTRACT_JOB_PAGE_SIZE;
  const pageCount = data === undefined ? page : Math.max(1, Math.ceil(data.total / pageSize));
  const showPager = page > 1 || (data !== undefined && data.total > pageSize);

  function setPage(next: number): void {
    const target = Math.max(1, next);
    const params = new URLSearchParams(search);
    if (target <= 1) params.delete('page');
    else params.set('page', String(target));
    setSearch(params);
  }

  let body;
  if (query.isPending) {
    body = <p className="py-16 text-[length:var(--text-meta)] text-muted">{t.inbox.loading}</p>;
  } else if (query.error) {
    body = (
      <p className="py-16 text-[length:var(--text-meta)] text-danger">{humanError(query.error)}</p>
    );
  } else if (data === undefined || data.items.length === 0) {
    body =
      data === undefined || data.total === 0 ? (
        <p className="py-16 text-[length:var(--text-meta)] text-muted">{t.inbox.jobs.empty}</p>
      ) : null;
  } else {
    body = <JobRows items={data.items} timeZone={timeZone} />;
  }

  return (
    <main
      id="main"
      data-region="reading-canvas"
      aria-label={t.inbox.jobs.label}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-canvas"
    >
      <header className="sticky top-0 z-[var(--z-sticky)] bg-canvas/90 backdrop-blur-sm">
        <div className={`${CONTENT_WIDTH} flex h-12 items-center gap-3`}>
          <Link
            to={inboxListPath('/inbox', search)}
            className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted transition-[background-color,color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg"
          >
            <Icon icon={ChevronLeft} size={13} />
            {t.inbox.back}
          </Link>
          <h2 className="min-w-0 truncate text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-fg">
            {t.inbox.jobs.label}
          </h2>
        </div>
      </header>
      <div className={`${CONTENT_WIDTH} pb-16 pt-2`}>
        {body}
        {showPager ? (
          <nav aria-label={t.inbox.jobs.paging} className="mt-8 flex items-center gap-2">
            <Button
              variant="quiet"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(data !== undefined && page > pageCount ? pageCount : page - 1)}
            >
              {t.inbox.jobs.prev}
            </Button>
            <p className="font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] tabular-nums text-tertiary">
              {data === undefined
                ? String(page)
                : t.inbox.jobs.pageOf
                    .replace('{page}', String(page))
                    .replace('{pages}', String(pageCount))}
            </p>
            <Button
              variant="quiet"
              size="sm"
              disabled={data === undefined || page >= pageCount}
              onClick={() => setPage(page + 1)}
            >
              {t.inbox.jobs.next}
            </Button>
          </nav>
        ) : null}
      </div>
    </main>
  );
});
