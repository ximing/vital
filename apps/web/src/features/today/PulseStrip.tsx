import type { TodayPulse } from '@vital/dto';
import { Link } from 'react-router';
import { t } from '@/copy';

/** One-line pulse of the whole system, shown above the board. */
export function PulseStrip({ pulse }: { pulse: TodayPulse }) {
  const reportHref = pulse.todayReportId ? `/reports/${pulse.todayReportId}` : '/reports';
  return (
    <div
      data-region="pulse-strip"
      className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
    >
      <Link to="/inbox" className="rounded transition-colors hover:text-fg">
        <b className="font-display font-bold text-fg">{pulse.inboxPending}</b>{' '}
        {t.today.pulseInboxSuffix}
      </Link>
      <span aria-hidden="true" className="text-tertiary">
        ·
      </span>
      {pulse.reportStreak > 0 ? (
        <span>
          {t.today.pulseStreakPrefix}{' '}
          <b className="font-display font-bold text-fg">{pulse.reportStreak}</b>{' '}
          {t.today.pulseStreakSuffix}
        </span>
      ) : (
        <span className="text-tertiary">{t.today.pulseNoStreak}</span>
      )}
      <span aria-hidden="true" className="text-tertiary">
        ·
      </span>
      {pulse.todayReportId ? (
        <Link to={reportHref} className="rounded text-tertiary transition-colors hover:text-fg">
          {t.today.pulseReportDone}
        </Link>
      ) : (
        <>
          <span className="text-tertiary">{t.today.pulseReportTodo}</span>
          <Link
            to={reportHref}
            className="rounded font-medium text-accent underline-offset-4 hover:underline"
          >
            {t.today.pulseGo}
          </Link>
        </>
      )}
    </div>
  );
}
