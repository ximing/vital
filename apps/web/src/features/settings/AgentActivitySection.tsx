import { AgentExecutionSection } from './AgentExecutionSection';
import { AgentScheduleSection } from './AgentScheduleSection';
import { formatCost } from './UsageSection';
import type { ReactNode } from 'react';
import type { AgentActionLogItem, AgentMetricsResponse } from '@vital/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/api/client';
import { t } from '@/copy';

const copy = t.settings.activity;

const METRICS_DAYS = 30;

/** Trend vs the previous window in percentage points; < 1pp counts as flat. */
function trendOf(summary: AgentMetricsResponse['summary']): {
  dir: 'up' | 'down' | 'flat';
  label: string;
} {
  const diffPp = (summary.adoptionRate - summary.prevAdoptionRate) * 100;
  if (Math.abs(diffPp) < 1) return { dir: 'flat', label: copy.metrics.flat };
  const dir = diffPp > 0 ? 'up' : 'down';
  return { dir, label: `${dir === 'up' ? '↑' : '↓'} ${Math.abs(diffPp).toFixed(1)}pp` };
}

/** Lightweight one-line evidence bar: proposals, adoption rate, trend vs the previous window. */
function AdoptionSummary({ data }: { data: AgentMetricsResponse | undefined }) {
  if (!data) return null;
  const { summary } = data;

  if (summary.proposed === 0) {
    return (
      <p
        data-region="adoption-summary"
        data-trend="none"
        className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
      >
        {copy.metrics.empty}
      </p>
    );
  }

  const trend = trendOf(summary);
  return (
    <p
      data-region="adoption-summary"
      data-trend={trend.dir}
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border pb-3 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
    >
      <span>
        {copy.metrics.window}
        {copy.metrics.proposed}{' '}
        <span className="font-medium tabular-nums text-fg">{summary.proposed}</span>{' '}
        {copy.metrics.proposedUnit}
      </span>
      <span aria-hidden="true">·</span>
      <span>
        {copy.metrics.adoptionRate}{' '}
        <span className="font-medium tabular-nums text-fg">
          {Math.round(summary.adoptionRate * 100)}%
        </span>
      </span>
      <span aria-hidden="true">·</span>
      <span
        data-trend-label={trend.dir}
        className={trend.dir === 'up' ? 'font-medium text-fg' : undefined}
      >
        {trend.label}
      </span>
    </p>
  );
}

const ACTION_LABELS: Record<string, string> = copy.actions;
const capabilityLabels: Record<string, string> = t.settings.usage.capabilities;

/**
 * Per-capability effective cost under the adoption bar: what each capability
 * spent in the window, and the amortized cost of each of its adopted proposals.
 */
function CapabilityCosts({ data }: { data: AgentMetricsResponse | undefined }) {
  const rows = data?.summary.perCapability ?? [];
  if (rows.length === 0) return null;
  return (
    <ul data-region="capability-costs" className="flex flex-col border-b border-border pb-3">
      {rows.map((row) => (
        <li
          key={row.capability}
          data-cost-capability={row.capability}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
        >
          <span className="font-medium text-fg">{capabilityLabels[row.capability] ?? row.capability}</span>
          <span className="tabular-nums">{copy.costs.adopted.replace('{n}', String(row.adopted))}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{copy.costs.cost.replace('{cost}', formatCost(row.costMicros, 4))}</span>
          <span aria-hidden="true">·</span>
          {/* Amortized: one run may produce several proposals — cost is divided across adopted ones. */}
          <span className="tabular-nums">
            {row.costPerAdoptedMicros === null
              ? copy.costs.noAdopted
              : copy.costs.perAdopted.replace('{cost}', formatCost(row.costPerAdoptedMicros, 4))}
          </span>
        </li>
      ))}
    </ul>
  );
}

function actionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? actionType;
}

/** Undo (undoOutcome) settles outcome.create as 'dismissed' and deletes the thread. */
function resultLabel(item: AgentActionLogItem): string {
  if (item.actionType === 'outcome.create' && item.feedback === 'dismissed') {
    return copy.results.undone;
  }
  return copy.results[item.feedback] ?? item.feedback;
}

function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA');
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function dayLabel(day: string, today: string): string {
  const [, m, d] = day.split('-');
  const base = `${Number(m)}月${Number(d)}日`;
  return day === today ? `${base} ${copy.todaySuffix}` : base;
}

interface DayGroup {
  day: string;
  items: AgentActionLogItem[];
}

/** Items arrive newest-first from the server, so equal days are already adjacent. */
function groupByDay(items: AgentActionLogItem[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const item of items) {
    const day = localDay(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

function detailText(item: AgentActionLogItem): string {
  const summary = item.payloadSummary.trim();
  if (item.targetName !== null) {
    return summary === '' ? item.targetName : `${item.targetName}：${summary}`;
  }
  return summary === '' ? copy.deletedTarget : summary;
}

export function AgentActivitySection() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['settings', 'agent-activity', 7],
    queryFn: () => client.listAgentActions({ days: 7 }),
  });
  const metricsQuery = useQuery({
    queryKey: ['settings', 'agent-metrics', METRICS_DAYS],
    queryFn: () => client.getAgentMetrics(METRICS_DAYS),
  });
  const settle = useMutation({
    mutationFn: ({ id, feedback }: { id: string; feedback: 'accepted' | 'dismissed' }) =>
      client.sendAgentActionFeedback(id, { feedback }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'agent-activity'] });
      void qc.invalidateQueries({ queryKey: ['settings', 'agent-metrics'] });
    },
  });

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">…</p>
    );
  } else if (query.isError) {
    body = (
      <p role="alert" className="text-[length:var(--text-meta)] text-muted">
        {copy.error}
      </p>
    );
  } else if (!query.data || query.data.length === 0) {
    body = (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {copy.empty}
      </p>
    );
  } else {
    const today = new Date().toLocaleDateString('en-CA');
    const groups = groupByDay(query.data);

    body = (
      <div className="flex flex-col gap-5" data-region="agent-activity">
        {groups.map((group) => (
          <div key={group.day}>
            <p
              data-activity-day={group.day}
              className="text-[11px] font-semibold uppercase tracking-wider text-tertiary"
            >
              {dayLabel(group.day, today)}
            </p>
            <ul className="mt-1 flex flex-col">
              {group.items.map((item) => (
                <li
                  key={item.id}
                  data-activity-row={item.id}
                  data-activity-feedback={item.feedback}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border py-2.5 last:border-b-0"
                >
                  <span className="font-mono text-[length:var(--text-caption)] tabular-nums text-tertiary">
                    {timeLabel(item.createdAt)}
                  </span>
                  <span className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] font-medium text-fg">
                    {actionLabel(item.actionType)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
                    {detailText(item)}
                  </span>
                  {item.feedback === 'pending' ? (
                    <span className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={settle.isPending}
                        onClick={() => settle.mutate({ id: item.id, feedback: 'accepted' })}
                        className="inline-flex h-6 items-center rounded-full bg-accent-subtle px-2.5 text-[11px] font-medium text-fg transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {copy.accept}
                      </button>
                      <button
                        type="button"
                        disabled={settle.isPending}
                        onClick={() => settle.mutate({ id: item.id, feedback: 'dismissed' })}
                        className="inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {copy.dismiss}
                      </button>
                    </span>
                  ) : (
                    <span
                      className={`shrink-0 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] ${
                        item.feedback === 'accepted' || item.feedback === 'edited'
                          ? 'text-muted'
                          : 'text-tertiary'
                      }`}
                    >
                      {resultLabel(item)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <AgentExecutionSection />
      <AgentScheduleSection />
      <h3 className="text-[length:var(--text-meta)] font-semibold text-fg">{copy.proposals}</h3>
      <AdoptionSummary data={metricsQuery.data} />
      <CapabilityCosts data={metricsQuery.data} />
      {body}
    </div>
  );
}
