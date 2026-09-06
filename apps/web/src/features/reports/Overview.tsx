import type { ReportOverview, ReportType } from '@vital/dto';
import { t } from '@/copy';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { humanError } from '@/lib/errors';
import { useReportOverviewQuery } from './queries';

function deltaText(n: number): string | null {
  if (n === 0) return null;
  return n > 0 ? `↑${n}` : `↓${Math.abs(n)}`;
}

function Stat({
  label,
  value,
  delta,
}: {
  label: string;
  value: number;
  delta: number;
}) {
  const d = deltaText(delta);
  return (
    <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
      {label}{' '}
      <span className="font-semibold tabular-nums text-fg">{value}</span>
      {d ? <span> {d}</span> : null}
    </span>
  );
}

export function ReportsOverview({
  type,
  onPick,
}: {
  type: ReportType;
  onPick: (ymd: string) => void;
}) {
  const query = useReportOverviewQuery(type);
  const data = query.data;

  if (query.error) {
    return (
      <div className="flex items-center gap-3 py-6">
        <Banner>{humanError(query.error)}</Banner>
        <Button variant="ghost" onClick={() => void query.refetch()}>
          {t.reports.retry}
        </Button>
      </div>
    );
  }

  if (query.isLoading || !data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-6 py-10" aria-busy="true" aria-label={t.reports.loading}>
        <div className="skeleton-pulse h-10 w-48 rounded-lg" />
        <div className="skeleton-pulse h-40 rounded-lg" />
      </div>
    );
  }

  return <OverviewBody data={data} onPick={onPick} />;
}

function OverviewBody({
  data,
  onPick,
}: {
  data: ReportOverview;
  onPick: (ymd: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-4">
      <p className="text-[length:var(--text-title)] font-semibold tracking-[-0.03em] text-fg">
        {data.period.label}
      </p>
      <div className="mt-3 flex flex-wrap gap-4">
        <Stat
          label={t.reports.completed}
          value={data.totals.completed}
          delta={data.totals.completedDelta}
        />
        <Stat label={t.reports.wrote} value={data.totals.wrote} delta={data.totals.wroteDelta} />
        <Stat label={t.reports.carried} value={data.totals.carried} delta={0} />
      </div>
      {data.streaks.completedDays > 0 || data.streaks.wroteDays > 0 ? (
        <p className="mt-4 text-[length:var(--text-caption)] text-muted">
          {data.streaks.completedDays > 0
            ? t.reports.streakCompleted.replace('{n}', String(data.streaks.completedDays))
            : null}
          {data.streaks.completedDays > 0 && data.streaks.wroteDays > 0 ? ' · ' : null}
          {data.streaks.wroteDays > 0
            ? t.reports.streakWrote.replace('{n}', String(data.streaks.wroteDays))
            : null}
        </p>
      ) : null}
      <div className="mt-8">
        <p className="mb-2 text-[length:var(--text-caption)] text-muted">{t.reports.recentDone}</p>
        {data.recentDone.length === 0 ? (
          <p className="text-[length:var(--text-body)] text-muted">{t.reports.emptyRecent}</p>
        ) : (
          <ul className="flex flex-col">
            {data.recentDone.map((item) => (
              <li key={`${item.taskId}-${item.completedAt}`}>
                <button
                  type="button"
                  className="w-full truncate rounded-lg px-3 py-2.5 text-left text-[length:var(--text-body)] text-fg hover:bg-surface-muted"
                  onClick={() => onPick(data.period.start)}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button className="mt-8 self-start" onClick={() => onPick(data.period.start)}>
        {t.reports.openPeriod}
      </Button>
    </div>
  );
}
