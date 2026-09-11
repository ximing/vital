import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentScheduleItem } from '@vital/dto';
import { client } from '@/api/client';
import { t } from '@/copy';

const copy = t.settings.activity.schedule;
const capabilityLabels: Record<string, string> = t.settings.usage.capabilities;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** What the capability is currently waiting for, next to the pending count. */
function waitDetail(item: AgentScheduleItem): string | null {
  if (item.status === 'waiting' && item.dueAt) return copy.dueAt.replace('{time}', timeLabel(item.dueAt));
  if (item.status === 'cooldown' && item.cooldownUntil) {
    return copy.cooldownUntil.replace('{time}', timeLabel(item.cooldownUntil));
  }
  return null;
}

function ScheduleRow({ item }: { item: AgentScheduleItem }) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['settings', 'agent-schedule'] });
    void qc.invalidateQueries({ queryKey: ['settings', 'agent-executions'] });
  };
  const runNow = useMutation({
    // Reuses the existing manual dispatch endpoints — no new trigger API.
    mutationFn: () =>
      item.capability === 'outcome.cluster' ? client.organizeAgentTasks() : client.distillAgentMemory(),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => client.cancelAgentSchedule(item.capability),
    onSuccess: refresh,
  });

  const busy = runNow.isPending || cancel.isPending;
  return (
    <li
      data-schedule-row={item.capability}
      data-schedule-status={item.status}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2.5 last:border-b-0"
    >
      <span className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] font-medium text-fg">
        {capabilityLabels[item.capability] ?? item.capability}
      </span>
      <span
        data-schedule-badge={item.status}
        className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium ${
          item.status === 'idle' ? 'bg-surface-muted text-muted' : 'bg-accent-subtle text-fg'
        }`}
      >
        {copy.statuses[item.status]}
      </span>
      {item.pendingCount > 0 && (
        <span className="text-[length:var(--text-caption)] tabular-nums text-muted">
          {copy.pending.replace('{n}', String(item.pendingCount))}
        </span>
      )}
      {waitDetail(item) && (
        <span className="text-[length:var(--text-caption)] text-muted">{waitDetail(item)}</span>
      )}
      <span className="text-[length:var(--text-caption)] text-tertiary">
        {item.lastSucceededAt
          ? copy.lastSucceeded.replace('{time}', timeLabel(item.lastSucceededAt))
          : copy.never}
      </span>
      <span className="flex flex-1 justify-end gap-1.5">
        <button
          type="button"
          data-schedule-action="run-now"
          disabled={busy}
          onClick={() => runNow.mutate()}
          className="inline-flex h-6 items-center rounded-full bg-accent-subtle px-2.5 text-[11px] font-medium text-fg transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {copy.runNow}
        </button>
        <button
          type="button"
          data-schedule-action="cancel"
          disabled={busy || item.status === 'idle'}
          onClick={() => cancel.mutate()}
          className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          {copy.cancel}
        </button>
      </span>
      {runNow.isSuccess && (
        <span role="status" className="w-full text-[length:var(--text-caption)] text-muted">
          {copy.queued}
        </span>
      )}
      {cancel.isSuccess && (
        <span role="status" className="w-full text-[length:var(--text-caption)] text-muted">
          {copy.cancelled}
        </span>
      )}
    </li>
  );
}

/** Read-only "what is the agent waiting for" view with run-now / cancel actions. */
export function AgentScheduleSection() {
  const query = useQuery({
    queryKey: ['settings', 'agent-schedule'],
    queryFn: () => client.listAgentSchedule(),
    refetchInterval: 15_000,
  });

  return (
    <section aria-label={copy.title}>
      <h3 className="text-[length:var(--text-meta)] font-semibold text-fg">{copy.title}</h3>
      <p className="mt-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
        {copy.hint}
      </p>
      {query.isPending ? (
        <p className="mt-2 text-[length:var(--text-meta)] text-muted">…</p>
      ) : query.isError ? (
        <p role="alert" className="mt-2 text-[length:var(--text-meta)] text-muted">
          {copy.error}
        </p>
      ) : (
        <ul className="mt-1" data-region="agent-schedule">
          {query.data.items.map((item) => (
            <ScheduleRow key={item.capability} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
