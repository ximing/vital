import type { AgentUsageDaily } from '@vital/dto';
import { useQuery } from '@tanstack/react-query';
import { client } from '@/api/client';
import { t } from '@/copy';

const copy = t.settings.usage;

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** micro-USD → "$0.000123" (digits default 3); shared with the capability cost rows. */
export function formatCost(micros: number, digits = 3): string {
  return `$${(micros / 1_000_000).toFixed(digits)}`;
}

function dayLabel(date: string, today: string): string {
  const [, m, d] = date.split('-');
  const base = `${Number(m)}月${Number(d)}日`;
  return date === today ? `${base} ${copy.todaySuffix}` : base;
}

const CAPABILITY_LABELS: Record<string, string> = t.settings.usage.capabilities;

function capabilityLabel(capability: string): string {
  return CAPABILITY_LABELS[capability] ?? capability;
}

interface DayGroup {
  date: string;
  rows: AgentUsageDaily[];
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
}

function groupByDay(items: AgentUsageDaily[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const item of items) {
    let group = groups.get(item.date);
    if (!group) {
      group = { date: item.date, rows: [], promptTokens: 0, completionTokens: 0, costMicros: 0 };
      groups.set(item.date, group);
    }
    group.rows.push(item);
    group.promptTokens += item.promptTokens;
    group.completionTokens += item.completionTokens;
    group.costMicros += item.costMicros;
  }
  // Server returns ascending; show the most recent day first.
  return [...groups.values()].reverse();
}

export function UsageSection() {
  const query = useQuery({
    queryKey: ['settings', 'agent-usage', 30],
    queryFn: () => client.getAgentUsage(30),
  });

  if (query.isPending) {
    return (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">…</p>
    );
  }

  if (query.isError || !query.data) {
    return (
      <p
        role="alert"
        className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted"
      >
        {copy.error}
      </p>
    );
  }

  const summary = query.data;
  if (
    summary.items.length === 0 &&
    summary.totalRuns === 0 &&
    !summary.modelRequests &&
    !summary.legacyRuns
  ) {
    return (
      <p className="text-[length:var(--text-meta)] leading-[var(--text-meta-lh)] text-muted">
        {copy.empty}
      </p>
    );
  }

  const today = new Date().toLocaleDateString('en-CA');
  const groups = groupByDay(summary.items);
  const totalTokens = summary.totalPromptTokens + summary.totalCompletionTokens;

  return (
    <div>
      <div className="mt-1 flex flex-wrap gap-x-7 gap-y-4">
        <div>
          <p className="font-display text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] tracking-tight text-fg">
            {formatTokens(totalTokens)}
          </p>
          <p className="mt-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
            {copy.totalTokens}
          </p>
        </div>
        <div>
          <p className="font-display text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] tracking-tight text-fg">
            {formatCost(summary.totalCostMicros, 2)}
          </p>
          <p className="mt-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
            {copy.totalCost}
          </p>
        </div>
        <div>
          <p className="font-display text-[length:var(--text-title)] font-bold leading-[var(--text-title-lh)] tracking-tight text-fg">
            {summary.modelRequests ?? '—'}
          </p>
          <p className="mt-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-lh)] text-tertiary">
            {copy.totalRuns}
          </p>
        </div>
        {[
          [copy.failedRequests, summary.failedRequests],
          [copy.unknownUsageRequests, summary.unknownUsageRequests],
          [copy.unknownCostRequests, summary.unknownCostRequests],
          [copy.legacyRuns, summary.legacyRuns ?? summary.totalRuns],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="font-display text-[length:var(--text-title)] font-bold text-fg">
              {value ?? '—'}
            </p>
            <p className="mt-0.5 text-[length:var(--text-caption)] text-tertiary">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[length:var(--text-caption)] text-muted">{copy.unknownUsageHint}</p>
      {(summary.unknownCostRequests ?? 0) > 0 && (
        <p className="mt-1 text-[length:var(--text-caption)] text-muted">{copy.unknownCostHint}</p>
      )}
      {(summary.legacyRuns ?? summary.totalRuns) > 0 && (
        <p className="mt-1 text-[length:var(--text-caption)] text-muted">{copy.legacyHint}</p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse" data-region="usage-table">
          <thead>
            <tr>
              <th className="border-b border-border py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-tertiary">
                {copy.colWhen}
              </th>
              <th className="border-b border-border py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-tertiary">
                {copy.colIn}
              </th>
              <th className="border-b border-border py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-tertiary">
                {copy.colOut}
              </th>
              <th className="border-b border-border py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-tertiary">
                {copy.colCost}
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <DayRows key={group.date} group={group} today={today} />
            ))}
            <tr data-usage-row="total">
              <td className="border-b border-border py-2.5 text-[length:var(--text-meta)] font-semibold text-fg">
                {copy.monthTotal}
              </td>
              <td className="border-b border-border py-2.5 font-mono text-[length:var(--text-caption)] font-semibold tabular-nums text-fg">
                {formatTokens(summary.totalPromptTokens)}
              </td>
              <td className="border-b border-border py-2.5 font-mono text-[length:var(--text-caption)] font-semibold tabular-nums text-fg">
                {formatTokens(summary.totalCompletionTokens)}
              </td>
              <td className="border-b border-border py-2.5 font-mono text-[length:var(--text-caption)] font-semibold tabular-nums text-fg">
                {formatCost(summary.totalCostMicros)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DayRows({ group, today }: { group: DayGroup; today: string }) {
  return (
    <>
      <tr data-usage-row="day">
        <td className="border-b border-border py-2.5 text-[length:var(--text-meta)] font-semibold text-fg">
          {dayLabel(group.date, today)}
        </td>
        <td className="border-b border-border py-2.5 font-mono text-[length:var(--text-caption)] font-semibold tabular-nums text-fg">
          {formatTokens(group.promptTokens)}
        </td>
        <td className="border-b border-border py-2.5 font-mono text-[length:var(--text-caption)] font-semibold tabular-nums text-fg">
          {formatTokens(group.completionTokens)}
        </td>
        <td className="border-b border-border py-2.5 font-mono text-[length:var(--text-caption)] font-semibold tabular-nums text-fg">
          {formatCost(group.costMicros)}
        </td>
      </tr>
      {group.rows.map((row) => (
        <tr key={`${group.date}:${row.capability}`} data-usage-row="capability">
          <td className="border-b border-border py-2.5 pl-[18px] text-[length:var(--text-meta)] text-muted">
            {capabilityLabel(row.capability)}
          </td>
          <td className="border-b border-border py-2.5 font-mono text-[length:var(--text-caption)] tabular-nums text-muted">
            {formatTokens(row.promptTokens)}
          </td>
          <td className="border-b border-border py-2.5 font-mono text-[length:var(--text-caption)] tabular-nums text-muted">
            {formatTokens(row.completionTokens)}
          </td>
          <td className="border-b border-border py-2.5 font-mono text-[length:var(--text-caption)] tabular-nums text-muted">
            {formatCost(row.costMicros)}
          </td>
        </tr>
      ))}
    </>
  );
}
