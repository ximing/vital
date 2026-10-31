import { Link } from 'react-router';
import { t } from '@/copy';
import { useExplorationWindowsQuery } from './queries';

function rangeLabel(start: string, end: string): { start: string; end: string } {
  const fmt = (ymd: string) => {
    const parts = ymd.split('-');
    const month = Number(parts[1] ?? '1');
    const day = Number(parts[2] ?? '1');
    return `${String(month)}月${String(day)}日`;
  };
  return { start: fmt(start), end: fmt(end) };
}

/** Quiet seasonal line on Today. Hidden when no open window. */
export function ExploreSeasonalLine() {
  const query = useExplorationWindowsQuery();
  const open = (query.data?.items ?? []).find((row) => row.status === 'open');
  if (!open) return null;
  const range = rangeLabel(open.startDate, open.endDate);
  const label = t.today.exploreLine.replace('{start}', range.start).replace('{end}', range.end);
  return (
    <p
      data-region="exploration-seasonal"
      className="mt-3 px-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
    >
      <Link
        to={`/explore/${open.id}`}
        className="underline-offset-4 hover:text-fg hover:underline"
      >
        {label}
      </Link>
    </p>
  );
}
