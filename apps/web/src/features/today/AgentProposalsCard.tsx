import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { client } from '@/api/client';
import { t } from '@/copy';
import { ACTIVITY_CARD } from '@/features/settings/ActivitySectionHead';
import { actionLabel, detailText, timeLabel } from '@/features/settings/AgentActivitySection';
import { TODAY_HEAD_LINK, TodaySectionHead } from './SectionHead';

const copy = t.today.agentProposals;
const activityCopy = t.settings.activity;

/**
 * Pending agent proposals on the today page — the one place the agent asks
 * for a decision. Shows up to 3; /activity holds the full list.
 */
export function AgentProposalsCard() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['today', 'agent-pending'],
    queryFn: () => client.listAgentActions({ days: 7 }),
  });
  const settle = useMutation({
    mutationFn: ({ id, feedback }: { id: string; feedback: 'accepted' | 'dismissed' }) =>
      client.sendAgentActionFeedback(id, { feedback }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['today', 'agent-pending'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'agent-activity'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'agent-metrics'] });
    },
  });

  const pending = (query.data ?? []).filter((item) => item.feedback === 'pending');
  if (pending.length === 0) return null;
  const shown = pending.slice(0, 3);

  return (
    <section data-region="agent-proposals" aria-label={copy.title} className="mt-7">
      <TodaySectionHead title={copy.title} count={pending.length}>
        <Link to="/activity" className={TODAY_HEAD_LINK}>
          {copy.all}
        </Link>
      </TodaySectionHead>
      <div className={ACTIVITY_CARD}>
        {shown.map((item) => (
          <div
            key={item.id}
            data-proposal-row={item.id}
            className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border px-5 py-3 last:border-b-0"
          >
            <span className="inline-flex h-[22px] shrink-0 items-center rounded-full bg-accent-subtle px-2.5 text-[11px] font-semibold text-accent">
              {actionLabel(item.actionType)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] font-medium text-fg">
                {detailText(item)}
              </p>
              <p className="font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
                {timeLabel(item.createdAt)}
              </p>
            </div>
            <button
              type="button"
              disabled={settle.isPending}
              onClick={() => settle.mutate({ id: item.id, feedback: 'accepted' })}
              className="inline-flex h-7 items-center rounded-full bg-accent px-3.5 text-[length:var(--text-caption)] font-semibold text-on-accent transition-[color,background-color] duration-[var(--ease-out)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activityCopy.accept}
            </button>
            <button
              type="button"
              disabled={settle.isPending}
              onClick={() => settle.mutate({ id: item.id, feedback: 'dismissed' })}
              className="inline-flex h-7 items-center rounded-full px-3 text-[length:var(--text-caption)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activityCopy.dismiss}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
