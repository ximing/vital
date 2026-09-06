import { useState } from 'react';
import type { ReportOverview, ReportType } from '@vital/dto';
import { t } from '@/copy';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { humanError } from '@/lib/errors';
import { useReportOverviewQuery } from './queries';
import { StreakCalendar } from './StreakCalendar';

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
    <div className="min-w-0 flex-1 rounded-2xl bg-surface px-4 py-3 shadow-[inset_0_0_0_1px_var(--border-subtle)]">
      <p className="text-[length:var(--text-caption)] text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-[length:var(--text-title)] font-semibold tabular-nums tracking-[-0.03em]">
          {value}
        </span>
        {d ? <span className="text-[length:var(--text-caption)] text-muted">{d}</span> : null}
      </p>
    </div>
  );
}

export function ReportsOverview({
  type,
  weekStartsOn,
  timeZone,
  onPick,
}: {
  type: ReportType;
  weekStartsOn: 0 | 1;
  timeZone: string;
  onPick: (ymd: string) => void;
}) {
  const [at, setAt] = useState<string | undefined>(undefined);
  const query = useReportOverviewQuery(type, at);
  const data = query.data;

  if (query.error) {
    return (
      <div className="flex items-center gap-3 px-4 py-6">
        <Banner>{humanError(query.error)}</Banner>
        <Button variant="ghost" onClick={() => void query.refetch()}>
          {t.reports.retry}
        </Button>
      </div>
    );
  }

  if (query.isLoading || !data) {
    return (
      <div
        className="mx-auto grid w-full max-w-[88rem] flex-1 gap-6 px-4 py-10 lg:grid-cols-[19rem_minmax(0,1fr)]"
        aria-busy="true"
        aria-label={t.reports.loading}
      >
        <div className="skeleton-pulse h-72 rounded-2xl" />
        <div className="skeleton-pulse h-40 rounded-2xl" />
      </div>
    );
  }

  return (
    <OverviewBody
      data={data}
      weekStartsOn={weekStartsOn}
      timeZone={timeZone}
      onPick={onPick}
      onCursorMonth={setAt}
    />
  );
}

function OverviewBody({
  data,
  weekStartsOn,
  timeZone,
  onPick,
  onCursorMonth,
}: {
  data: ReportOverview;
  weekStartsOn: 0 | 1;
  timeZone: string;
  onPick: (ymd: string) => void;
  onCursorMonth: (ymd: string) => void;
}) {
  return (
    <div className="mx-auto grid w-full max-w-[88rem] flex-1 gap-6 px-4 pb-16 pt-4 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
      <StreakCalendar
        type={data.type}
        heatmap={data.heatmap}
        grain={data.heatmapGrain}
        selectedStart={data.period.start}
        weekStartsOn={weekStartsOn}
        timeZone={timeZone}
        onPick={onPick}
        onCursorMonth={onCursorMonth}
      />
      <div className="min-w-0">
        <p className="text-[length:var(--text-meta)] font-medium text-fg">{data.period.label}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Stat
            label={t.reports.completed}
            value={data.totals.completed}
            delta={data.totals.completedDelta}
          />
          <Stat label={t.reports.wrote} value={data.totals.wrote} delta={data.totals.wroteDelta} />
          <Stat label={t.reports.carried} value={data.totals.carried} delta={0} />
        </div>
        {data.streaks.completedDays > 0 || data.streaks.wroteDays > 0 ? (
          <p className="mt-3 text-[length:var(--text-caption)] text-muted">
            {data.streaks.completedDays > 0
              ? t.reports.streakCompleted.replace('{n}', String(data.streaks.completedDays))
              : null}
            {data.streaks.completedDays > 0 && data.streaks.wroteDays > 0 ? ' · ' : null}
            {data.streaks.wroteDays > 0
              ? t.reports.streakWrote.replace('{n}', String(data.streaks.wroteDays))
              : null}
          </p>
        ) : null}
        <div className="mt-6">
          <p className="mb-2 text-[length:var(--text-caption)] text-muted">{t.reports.recentDone}</p>
          {data.recentDone.length === 0 ? (
            <p className="text-[length:var(--text-body)] text-muted">{t.reports.emptyRecent}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {data.recentDone.map((item) => (
                <li key={`${item.taskId}-${item.completedAt}`}>
                  <button
                    type="button"
                    className="w-full truncate rounded-xl px-3 py-2 text-left text-[length:var(--text-body)] text-fg hover:bg-surface-muted"
                    onClick={() => onPick(data.period.start)}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          className="mt-8 inline-flex min-h-[var(--touch-min)] items-center rounded-xl bg-accent-subtle px-4 text-fg hover:bg-surface-muted"
          onClick={() => onPick(data.period.start)}
        >
          {t.reports.openPeriod}
        </button>
      </div>
    </div>
  );
}
