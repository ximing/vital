import type { ReportType } from '@vital/dto';
import { t } from '@/copy';
import { useReportOverviewQuery } from './queries';

function deltaText(n: number): string | null {
  if (n === 0) return null;
  return n > 0 ? `↑${n}` : `↓${Math.abs(n)}`;
}

function Stat({ label, value, delta }: { label: string; value: number; delta: number }) {
  const d = deltaText(delta);
  return (
    <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted">
      {label}{' '}
      <span className="font-semibold tabular-nums text-fg">{value}</span>
      {d ? <span> {d}</span> : null}
    </span>
  );
}

/** Compact current-period stats shown under the history calendar. */
export function StatsBlock({ type }: { type: ReportType }) {
  const query = useReportOverviewQuery(type);
  const data = query.data;

  if (query.error || query.isLoading || !data) {
    return query.isLoading ? (
      <div className="skeleton-pulse mt-3 h-12 rounded-lg" aria-busy="true" />
    ) : null;
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Stat
          label={t.reports.completed}
          value={data.totals.completed}
          delta={data.totals.completedDelta}
        />
        <Stat label={t.reports.wrote} value={data.totals.wrote} delta={data.totals.wroteDelta} />
        <Stat label={t.reports.carried} value={data.totals.carried} delta={0} />
      </div>
      {data.streaks.completedDays > 0 || data.streaks.wroteDays > 0 ? (
        <p className="mt-2 text-[length:var(--text-caption)] font-medium text-accent">
          {data.streaks.completedDays > 0
            ? t.reports.streakCompleted.replace('{n}', String(data.streaks.completedDays))
            : null}
          {data.streaks.completedDays > 0 && data.streaks.wroteDays > 0 ? ' · ' : null}
          {data.streaks.wroteDays > 0
            ? t.reports.streakWrote.replace('{n}', String(data.streaks.wroteDays))
            : null}
        </p>
      ) : null}
    </div>
  );
}
