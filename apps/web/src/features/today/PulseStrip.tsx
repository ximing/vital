import type { TodayPulse } from '@vital/dto';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';

const CHIP =
  'inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg';

/** Live agent status: running executions get a pulsing dot; failures turn the chip amber. */
function AgentStatusChip() {
  const query = useQuery({
    queryKey: ['today', 'agent-exec-status'],
    queryFn: () => client.listAgentExecutions(1),
    refetchInterval: 15_000,
    retry: false,
  });
  const items = query.data ?? [];
  const running = items.filter((item) => item.status === 'running').length;
  const failed = items.filter((item) => item.status === 'failed').length;

  if (running > 0) {
    return (
      <Link to="/activity" className={CHIP} data-region="agent-status" data-status="running">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
        {t.today.agentStatus.running.replace('{n}', String(running))}
      </Link>
    );
  }
  if (failed > 0) {
    return (
      <Link
        to="/activity"
        className={`${CHIP} border-due text-due hover:text-due`}
        data-region="agent-status"
        data-status="attention"
      >
        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-due" />
        {t.today.agentStatus.attention.replace('{n}', String(failed))}
      </Link>
    );
  }
  return null;
}

/** One-line pulse of the whole system, shown as chips in the header. */
export function PulseStrip({ pulse }: { pulse: TodayPulse }) {
  const reportHref = pulse.todayReportId ? `/reports/${pulse.todayReportId}` : '/reports';
  return (
    <div data-region="pulse-strip" className="flex flex-wrap items-center justify-end gap-2">
      <Link to="/inbox" className={CHIP}>
        <b className="font-bold tabular-nums text-fg">{pulse.inboxPending}</b>
        {t.today.pulseInboxSuffix}
      </Link>
      {pulse.reportStreak > 0 ? (
        <span className={CHIP}>
          {t.today.pulseStreakPrefix} <b className="font-bold tabular-nums text-fg">{pulse.reportStreak}</b>{' '}
          {t.today.pulseStreakSuffix}
        </span>
      ) : (
        <span className={`${CHIP} text-tertiary`}>{t.today.pulseNoStreak}</span>
      )}
      {pulse.todayReportId ? (
        <Link to={reportHref} className={CHIP}>
          <span className="font-semibold text-done">✓</span>
          {t.today.pulseReportDone}
        </Link>
      ) : (
        <Link to={reportHref} className={CHIP}>
          <span className="text-tertiary">{t.today.pulseReportTodo}</span>
          <span className="font-semibold text-accent">{t.today.pulseGo}</span>
        </Link>
      )}
      <AgentStatusChip />
    </div>
  );
}
