import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { t } from '@/copy';

const copy = t.settings.activity.executions;
const capabilities: Record<string, string> = t.settings.usage.capabilities;
const reasons: Record<string, string> = copy.reasons;

function reasonLabel(reason: string | null): string | null {
  return reason ? (reasons[reason] ?? reason) : null;
}

export function AgentExecutionSection() {
  const query = useQuery({
    queryKey: ['settings', 'agent-executions', 7],
    queryFn: () => client.listAgentExecutions(7),
  });

  return (
    <section aria-label={copy.title}>
      <h3 className="text-[length:var(--text-meta)] font-semibold text-fg">{copy.title}</h3>
      {query.isPending ? (
        <p className="mt-2 text-muted">…</p>
      ) : query.isError ? (
        <p role="alert" className="mt-2 text-[length:var(--text-meta)] text-muted">
          {copy.error}
        </p>
      ) : query.data.length === 0 ? (
        <p className="mt-2 text-[length:var(--text-meta)] text-muted">{copy.empty}</p>
      ) : (
        <ul className="mt-1" data-region="agent-executions">
          {query.data.map((execution) => (
            <li
              key={execution.id}
              data-execution-status={execution.status}
              className={`border-b border-border py-3 last:border-b-0 ${execution.parentId ? 'ml-4 border-l pl-3' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--text-meta)]">
                <time
                  dateTime={execution.createdAt}
                  className="font-mono text-[length:var(--text-caption)] text-tertiary"
                >
                  {new Date(execution.createdAt).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </time>
                {execution.parentId && (
                  <span className="text-[length:var(--text-caption)] text-tertiary">
                    {copy.child}
                  </span>
                )}
                <span className="font-medium text-fg">
                  {capabilities[execution.capability] ?? execution.capability}
                </span>
                <span className="text-muted">{copy.statuses[execution.status]}</span>
                <span className="text-[length:var(--text-caption)] text-tertiary">
                  {copy.attempt} {execution.attempt}
                </span>
                {execution.durationMs !== null && (
                  <span className="text-[length:var(--text-caption)] text-tertiary">
                    {copy.duration} {(execution.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <p className="mt-1 break-words text-[length:var(--text-meta)] text-muted">
                {execution.resultSummary || reasonLabel(execution.reason) || copy.noResult}
              </p>
              {execution.reason && execution.resultSummary && (
                <p className="mt-1 break-words text-[length:var(--text-caption)] text-tertiary">
                  {reasonLabel(execution.reason)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
