import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { t } from '@/copy';
import { ACTIVITY_CARD, ActivitySectionHead } from './ActivitySectionHead';
import { AgentMaintenanceButton } from './AgentMaintenanceButton';

const copy = t.settings.activity.executions;
const capabilities: Record<string, string> = t.settings.usage.capabilities;
const reasons: Record<string, string> = copy.reasons;
const triggers: Record<string, string> = { manual: '手动触发', user_request: '用户操作', event: '数据变化', scheduled: '定时检查', 'daily-maintenance': '每日记忆整理' };

/** Timeline node + status text color per execution status. */
const STATUS_COLOR: Record<string, string> = {
  running: 'var(--accent-primary)',
  succeeded: 'var(--status-done)',
  failed: 'var(--status-overdue)',
  skipped: 'var(--status-due-soon)',
};

function reasonLabel(reason: string | null): string | null {
  return reason ? (reasons[reason] ?? reason) : null;
}

export function AgentExecutionSection() {
  const query = useQuery({
    queryKey: ['settings', 'agent-executions', 7],
    queryFn: () => client.listAgentExecutions(7),
    refetchInterval: 15_000,
  });

  return (
    <section aria-label={copy.title}>
      <ActivitySectionHead
        title={copy.title}
        hint={copy.hint}
        action={<AgentMaintenanceButton kind="threads" />}
      />
      {query.isPending ? (
        <p className="mt-2 text-muted">…</p>
      ) : query.isError ? (
        <p role="alert" className="mt-2 text-[length:var(--text-meta)] text-muted">
          {copy.error}
        </p>
      ) : query.data.length === 0 ? (
        <p className="mt-2 text-[length:var(--text-meta)] text-muted">{copy.empty}</p>
      ) : (
        <div className={`${ACTIVITY_CARD} px-5 py-2`}>
          <ul data-region="agent-executions">
            {query.data.map((execution) => {
              const child = execution.parentId !== null;
              const color = STATUS_COLOR[execution.status] ?? 'var(--text-tertiary)';
              return (
                <li
                  key={execution.id}
                  data-execution-status={execution.status}
                  className={`relative py-3 pl-7 before:absolute before:bg-border ${
                    child
                      ? 'ml-5 before:-left-[13px] before:top-[26px] before:h-px before:w-[13px]'
                      : 'before:left-[5px] before:top-0 before:h-full before:w-px first:before:top-5 last:before:h-5'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-[17px] h-[11px] w-[11px] rounded-full border-2 border-surface"
                    style={{ background: color, boxShadow: '0 0 0 1px var(--border-subtle)' }}
                  />
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    {child ? (
                      <span className="inline-flex items-center rounded-full border border-border px-2 py-px text-[11px] leading-4 text-tertiary">
                        {copy.child}
                      </span>
                    ) : null}
                    <span className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] font-semibold text-fg">
                      {capabilities[execution.capability] ?? execution.capability}
                    </span>
                    <span
                      className="text-[length:var(--text-caption)] font-semibold leading-[var(--text-caption-lh)]"
                      style={{ color }}
                    >
                      {copy.statuses[execution.status]}
                    </span>
                    <time
                      dateTime={execution.createdAt}
                      className="font-mono text-[length:var(--text-caption)] tabular-nums text-tertiary"
                    >
                      {new Date(execution.createdAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })}
                    </time>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
                    {execution.trigger ? (
                      <span>{triggers[execution.trigger] ?? execution.trigger}</span>
                    ) : null}
                    <span>
                      {copy.attempt} {execution.attempt}
                    </span>
                    {execution.durationMs !== null ? (
                      <span>
                        {copy.duration} {(execution.durationMs / 1000).toFixed(1)}s
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 break-words text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
                    {execution.resultSummary || reasonLabel(execution.reason) || copy.noResult}
                  </p>
                  {execution.inputSummary ? (
                    <p className="mt-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
                      {execution.inputSummary}
                    </p>
                  ) : null}
                  {execution.reason && execution.resultSummary ? (
                    <p className="mt-0.5 break-words text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
                      {reasonLabel(execution.reason)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
