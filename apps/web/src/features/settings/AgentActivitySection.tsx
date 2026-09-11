import { AgentExecutionSection } from './AgentExecutionSection';
import { AgentScheduleSection } from './AgentScheduleSection';
import { ACTIVITY_CARD, ActivitySectionHead } from './ActivitySectionHead';
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

const STAT_NUM =
  'font-display text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] tabular-nums';
const STAT_LBL =
  'mt-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted';

/** Overview strip: proposals, adoption rate with trend, and total backend cost in the window. */
function Overview({ data }: { data: AgentMetricsResponse | undefined }) {
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
  const totalCostMicros = summary.perCapability.reduce((sum, row) => sum + row.costMicros, 0);
  return (
    <div>
      <div data-region="adoption-summary" data-trend={trend.dir} className="grid gap-3 sm:grid-cols-3">
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {summary.proposed}
            <span className="ml-1 text-[length:var(--text-meta)] font-medium text-tertiary">
              {copy.metrics.proposedUnit}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.overview.proposedLabel}</p>
        </div>
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>
            {Math.round(summary.adoptionRate * 100)}%{' '}
            <span
              data-trend-label={trend.dir}
              className={`text-[length:var(--text-meta)] font-semibold ${
                trend.dir === 'up'
                  ? 'text-done'
                  : trend.dir === 'down'
                    ? 'text-overdue'
                    : 'text-tertiary'
              }`}
            >
              {trend.label}
            </span>
          </p>
          <p className={STAT_LBL}>{copy.overview.adoptionLabel}</p>
        </div>
        <div className={`${ACTIVITY_CARD} px-5 py-4`}>
          <p className={STAT_NUM}>{formatCost(totalCostMicros)}</p>
          <p className={STAT_LBL}>{copy.overview.costLabel}</p>
        </div>
      </div>
      <CapabilityCosts data={data} />
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = copy.actions;
const capabilityLabels: Record<string, string> = t.settings.usage.capabilities;

/** Per-capability effective cost chips: spend in the window + amortized cost per adopted proposal. */
function CapabilityCosts({ data }: { data: AgentMetricsResponse | undefined }) {
  const rows = data?.summary.perCapability ?? [];
  if (rows.length === 0) return null;
  return (
    <ul data-region="capability-costs" className="mt-3 flex flex-wrap gap-2">
      {rows.map((row) => (
        <li
          key={row.capability}
          data-cost-capability={row.capability}
          className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full border border-border bg-surface px-3 py-1 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-muted"
        >
          <span className="font-medium text-fg">
            {capabilityLabels[row.capability] ?? row.capability}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            {copy.costs.adopted.replace('{n}', String(row.adopted))}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">
            {copy.costs.cost.replace('{cost}', formatCost(row.costMicros, 4))}
          </span>
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

export function actionLabel(actionType: string): string {
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

export function timeLabel(iso: string): string {
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

export function detailText(item: AgentActionLogItem): string {
  const summary = item.payloadSummary.trim();
  if (item.targetName !== null) {
    return summary === '' ? item.targetName : `${item.targetName}：${summary}`;
  }
  return summary === '' ? copy.deletedTarget : summary;
}

/** Actionable proposals awaiting the user's call, lifted out of the timeline. */
function PendingProposals({
  items,
  busy,
  onSettle,
}: {
  items: AgentActionLogItem[];
  busy: boolean;
  onSettle: (id: string, feedback: 'accepted' | 'dismissed') => void;
}) {
  if (items.length === 0) return null;
  return (
    <section data-region="agent-activity" aria-label={copy.pending.title}>
      <ActivitySectionHead
        title={copy.pending.title}
        hint={copy.pending.count.replace('{n}', String(items.length))}
      />
      <div className={ACTIVITY_CARD}>
        {items.map((item) => (
          <div
            key={item.id}
            data-activity-row={item.id}
            data-activity-feedback={item.feedback}
            className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border px-5 py-3.5 last:border-b-0"
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
              disabled={busy}
              onClick={() => onSettle(item.id, 'accepted')}
              className="inline-flex h-7 items-center rounded-full bg-accent px-3.5 text-[length:var(--text-caption)] font-semibold text-on-accent transition-[color,background-color] duration-[var(--ease-out)] hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {copy.accept}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSettle(item.id, 'dismissed')}
              className="inline-flex h-7 items-center rounded-full px-3 text-[length:var(--text-caption)] font-medium text-muted transition-[color,background-color] duration-[var(--ease-out)] hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
            >
              {copy.dismiss}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Settled proposals grouped by day — the read-only record of what the agent produced. */
function ProposalHistory({ groups, today }: { groups: DayGroup[]; today: string }) {
  if (groups.length === 0) return null;
  return (
    <section data-region="agent-activity" aria-label={copy.history.title}>
      <ActivitySectionHead title={copy.history.title} hint={copy.history.hint} />
      <div className={`${ACTIVITY_CARD} px-5 pb-1.5`}>
        {groups.map((group) => (
          <div key={group.day}>
            <p
              data-activity-day={group.day}
              className="pt-3 text-[11px] font-semibold uppercase tracking-wider text-tertiary"
            >
              {dayLabel(group.day, today)}
            </p>
            <ul className="flex flex-col">
              {group.items.map((item) => {
                const positive = item.feedback === 'accepted' || item.feedback === 'edited';
                return (
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
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] ${
                        positive ? 'text-muted' : 'text-tertiary'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`h-[5px] w-[5px] rounded-full ${positive ? 'bg-done' : 'bg-tertiary'}`}
                      />
                      {resultLabel(item)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
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

  let pendingNode: ReactNode = null;
  let historyNode: ReactNode = null;
  let stateNode: ReactNode = null;
  if (query.isPending) {
    stateNode = (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">…</p>
    );
  } else if (query.isError) {
    stateNode = (
      <p role="alert" className="text-[length:var(--text-meta)] text-muted">
        {copy.error}
      </p>
    );
  } else if (!query.data || query.data.length === 0) {
    stateNode = (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {copy.empty}
      </p>
    );
  } else {
    const today = new Date().toLocaleDateString('en-CA');
    const pending = query.data.filter((item) => item.feedback === 'pending');
    const settled = query.data.filter((item) => item.feedback !== 'pending');
    pendingNode = (
      <PendingProposals
        items={pending}
        busy={settle.isPending}
        onSettle={(id, feedback) => settle.mutate({ id, feedback })}
      />
    );
    historyNode = <ProposalHistory groups={groupByDay(settled)} today={today} />;
  }

  return (
    <div className="flex flex-col gap-7">
      <Overview data={metricsQuery.data} />
      {stateNode}
      {pendingNode}
      <AgentScheduleSection />
      <AgentExecutionSection />
      {historyNode}
    </div>
  );
}
