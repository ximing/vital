import { useState } from 'react';
import type { ReportType } from '@vital/dto';
import { t } from '@/copy';
import { Banner } from '@/ui/banner';
import { Button } from '@/ui/button';
import { humanError } from '@/lib/errors';
import { useReportOverviewQuery } from './queries';
import { StreakCalendar } from './StreakCalendar';

export function ReportsCalendar({
  type,
  selectedStart,
  weekStartsOn,
  timeZone,
  onPick,
}: {
  type: ReportType;
  selectedStart?: string;
  weekStartsOn: 0 | 1;
  timeZone: string;
  onPick: (ymd: string) => void;
}) {
  const [at, setAt] = useState<string | undefined>(undefined);
  const query = useReportOverviewQuery(type, at);
  const data = query.data;

  if (query.error) {
    return (
      <div className="flex flex-col gap-2 px-1 py-2">
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
        className="skeleton-pulse min-h-64 rounded-lg"
        aria-busy="true"
        aria-label={t.reports.loading}
      />
    );
  }

  return (
    <StreakCalendar
      type={data.type}
      heatmap={data.heatmap}
      grain={data.heatmapGrain}
      selectedStart={selectedStart ?? data.period.start}
      weekStartsOn={weekStartsOn}
      timeZone={timeZone}
      onPick={onPick}
      onCursorMonth={setAt}
    />
  );
}
