import type {
  AgentAction,
  AgentActionLogItem,
  AgentCapabilityCost,
  AgentMetricsResponse,
  AgentScheduleItem,
} from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { ActivityPage } from '../../../src/pages/ai';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listAgentExecutions: vi.fn(),
      listAgentActions: vi.fn(),
      sendAgentActionFeedback: vi.fn(),
      getAgentMetrics: vi.fn(),
      listAgentSchedule: vi.fn(),
      cancelAgentSchedule: vi.fn(),
      organizeAgentTasks: vi.fn(),
      distillAgentMemory: vi.fn(),
    },
  };
});

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/activity" element={<ActivityPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

function item(input: Partial<AgentActionLogItem> & { id: string }): AgentActionLogItem {
  return {
    actionType: 'task.decompose',
    targetType: 'task',
    targetId: '00000000-0000-0000-0000-000000000001',
    payload: {},
    feedback: 'pending',
    feedbackPayload: null,
    feedbackAt: null,
    createdAt: new Date().toISOString(),
    targetName: null,
    payloadSummary: '',
    ...input,
  };
}

const todayIso = new Date().toISOString();
const yesterdayIso = new Date(Date.now() - 26 * 3600 * 1000).toISOString();

function metrics(summary: Partial<AgentMetricsResponse['summary']> = {}): AgentMetricsResponse {
  return {
    daily: [
      {
        date: '2026-09-08',
        proposed: 5,
        adopted: 3,
        dismissed: 1,
        undone: 1,
        adoptionRate: 0.75,
      },
    ],
    summary: {
      proposed: 12,
      adopted: 7,
      dismissed: 3,
      undone: 2,
      adoptionRate: 0.7,
      prevAdoptionRate: 0.5,
      perCapability: [],
      ...summary,
    },
  };
}

function scheduleItem(
  input: Partial<AgentScheduleItem> & { capability: AgentScheduleItem['capability'] },
): AgentScheduleItem {
  return {
    generation: 0,
    processedGeneration: 0,
    pendingCount: 0,
    urgent: false,
    pendingSince: null,
    dueAt: null,
    cooldownUntil: null,
    lastSucceededAt: null,
    observedAt: null,
    updatedAt: todayIso,
    status: 'idle',
    ...input,
  };
}

const baseItems: AgentActionLogItem[] = [
  item({
    id: 'a1',
    actionType: 'outcome.create',
    targetType: 'outcome',
    feedback: 'pending',
    createdAt: todayIso,
    targetName: '整理项目笔记',
    payloadSummary: '整理项目笔记',
  }),
  item({
    id: 'a2',
    actionType: 'task.decompose',
    feedback: 'edited',
    createdAt: todayIso,
    targetName: '写季度总结',
    payloadSummary: '列大纲、填数据',
  }),
  item({
    id: 'a3',
    actionType: 'outcome.create',
    targetType: 'outcome',
    feedback: 'dismissed', // undo settles as dismissed — the UI relabels to 已撤销
    createdAt: yesterdayIso,
    targetName: null,
    payloadSummary: '过时的线程',
  }),
  item({
    id: 'a4',
    actionType: 'outcome.headline',
    targetType: 'outcome',
    feedback: 'accepted',
    createdAt: yesterdayIso,
    targetName: '梳理 Q4 采购',
    payloadSummary: '进展顺利',
  }),
];

describe('activity page', () => {
  beforeEach(() => {
    vi.mocked(client.listAgentExecutions).mockResolvedValue([]);
    vi.mocked(client.listAgentActions).mockResolvedValue(baseItems);
    vi.mocked(client.sendAgentActionFeedback).mockResolvedValue(
      baseItems[0]! as unknown as AgentAction,
    );
    vi.mocked(client.getAgentMetrics).mockResolvedValue(metrics());
    vi.mocked(client.listAgentSchedule).mockResolvedValue({ items: [] });
  });

  it('renders the page, groups by day, labels capabilities and results', async () => {
    renderAt('/activity');
    expect(screen.getByRole('heading', { name: t.settings.activity.title })).toBeInTheDocument();

    await waitFor(() => {
      expect(client.listAgentActions).toHaveBeenCalledWith({ days: 7 });
    });
    // Wait until the rows are actually painted, not just the query fired.
    await waitFor(() => {
      expect(document.querySelectorAll('[data-activity-row]')).toHaveLength(4);
    });

    const copy = t.settings.activity;
    // Capability labels (outcome.create appears in both day groups).
    expect(screen.getAllByText(copy.actions['outcome.create'])).toHaveLength(2);
    expect(screen.getByText(copy.actions['task.decompose'])).toBeInTheDocument();
    expect(screen.getByText(copy.actions['outcome.headline'])).toBeInTheDocument();

    // Content: target name + digest, or digest alone for deleted targets.
    expect(screen.getByText('整理项目笔记：整理项目笔记')).toBeInTheDocument();
    expect(screen.getByText('写季度总结：列大纲、填数据')).toBeInTheDocument();
    expect(screen.getByText('梳理 Q4 采购：进展顺利')).toBeInTheDocument();

    // Result labels — pending gets quick actions instead of a label.
    expect(screen.getByText(copy.results.edited)).toBeInTheDocument();
    expect(screen.getByText(copy.results.undone)).toBeInTheDocument();
    expect(screen.getByText(copy.results.accepted)).toBeInTheDocument();
    expect(screen.queryByText(copy.results.pending)).not.toBeInTheDocument();

    // Two day groups, today first with the suffix.
    const days = [...document.querySelectorAll('[data-activity-day]')];
    expect(days).toHaveLength(2);
    expect(days[0]?.textContent).toContain(copy.todaySuffix);

    const rows = document.querySelectorAll('[data-activity-row]');
    expect(rows).toHaveLength(4);
  });

  it('settles pending actions with the quick buttons and refreshes', async () => {
    let items = [...baseItems];
    vi.mocked(client.listAgentActions).mockImplementation(async () => items);
    vi.mocked(client.sendAgentActionFeedback).mockImplementation(async (id, input) => {
      items = items.map((it) => (it.id === id ? { ...it, feedback: input.feedback } : it));
      return items.find((it) => it.id === id) as unknown as AgentAction;
    });

    renderAt('/activity');
    await waitFor(() => {
      expect(screen.getByText(t.settings.activity.accept)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(t.settings.activity.accept));
    await waitFor(() => {
      expect(client.sendAgentActionFeedback).toHaveBeenCalledWith('a1', { feedback: 'accepted' });
    });

    // Invalidated + refetched: a1 flips to 已采纳 (a4 was already accepted) and the buttons disappear.
    await waitFor(() => {
      expect(vi.mocked(client.listAgentActions).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(screen.getAllByText(t.settings.activity.results.accepted)).toHaveLength(2);
    });
    expect(screen.queryByText(t.settings.activity.accept)).not.toBeInTheDocument();
  });

  it('shows a friendly empty state', async () => {
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.getAgentMetrics).mockResolvedValue(
      metrics({ proposed: 0, adopted: 0, dismissed: 0, adoptionRate: 0, prevAdoptionRate: 0 }),
    );
    renderAt('/activity');
    await waitFor(() => {
      expect(screen.getByText(t.settings.activity.empty)).toBeInTheDocument();
    });
    expect(document.querySelector('[data-region="agent-activity"]')).toBeNull();
  });

  it('renders the adoption summary bar with an up trend vs the previous window', async () => {
    renderAt('/activity');
    await waitFor(() => {
      expect(client.getAgentMetrics).toHaveBeenCalledWith(30);
    });
    const bar = await waitFor(() => {
      const el = document.querySelector('[data-region="adoption-summary"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(bar).toHaveAttribute('data-trend', 'up');
    expect(bar.textContent).toContain(t.settings.activity.overview.proposedLabel);
    expect(bar.textContent).toContain('12');
    expect(bar.textContent).toContain(t.settings.activity.overview.adoptionLabel);
    expect(bar.textContent).toContain('70%');
    expect(bar.textContent).toContain('↑ 20.0pp');
  });

  it('flips the trend arrow when adoption dropped', async () => {
    vi.mocked(client.getAgentMetrics).mockResolvedValue(
      metrics({ adoptionRate: 0.4, prevAdoptionRate: 0.65 }),
    );
    renderAt('/activity');
    const bar = await waitFor(() => {
      const el = document.querySelector('[data-region="adoption-summary"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(bar).toHaveAttribute('data-trend', 'down');
    expect(bar.textContent).toContain('↓ 25.0pp');
  });

  it('shows 持平 when the trend moved less than one percentage point', async () => {
    vi.mocked(client.getAgentMetrics).mockResolvedValue(
      metrics({ adoptionRate: 0.5, prevAdoptionRate: 0.505 }),
    );
    renderAt('/activity');
    const bar = await waitFor(() => {
      const el = document.querySelector('[data-region="adoption-summary"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(bar).toHaveAttribute('data-trend', 'flat');
    expect(bar.textContent).toContain(t.settings.activity.metrics.flat);
    expect(bar.textContent).not.toContain('pp');
  });

  it('shows 暂无数据 in the summary bar when nothing was proposed', async () => {
    vi.mocked(client.getAgentMetrics).mockResolvedValue(
      metrics({ proposed: 0, adopted: 0, dismissed: 0, adoptionRate: 0, prevAdoptionRate: 0 }),
    );
    renderAt('/activity');
    const bar = await waitFor(() => {
      const el = document.querySelector('[data-region="adoption-summary"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(bar).toHaveAttribute('data-trend', 'none');
    expect(bar.textContent).toContain(t.settings.activity.metrics.empty);
  });
});

describe('execution telemetry', () => {
  beforeEach(() => {
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.getAgentMetrics).mockResolvedValue(metrics());
    vi.mocked(client.listAgentSchedule).mockResolvedValue({ items: [] });
  });

  it('shows failed and skipped executions without proposals and preserves reasons', async () => {
    vi.mocked(client.listAgentExecutions).mockResolvedValue([
      {
        id: 'e1',
        parentId: null,
        jobId: null,
        capability: 'agent.distill',
        status: 'failed',
        attempt: 2,
        reason: 'LLM_TIMEOUT',
        targetType: null,
        targetId: null,
        resultSummary: null,
        createdAt: todayIso,
        finishedAt: todayIso,
        durationMs: 1200,
      },
      {
        id: 'e2',
        parentId: 'e1',
        jobId: null,
        capability: 'agent.notify',
        status: 'skipped',
        attempt: 1,
        reason: 'NO_CHANGES',
        targetType: null,
        targetId: null,
        resultSummary: null,
        createdAt: todayIso,
        finishedAt: todayIso,
        durationMs: 0,
      },
    ]);
    renderAt('/activity');
    expect(await screen.findByText('模型请求超时')).toBeInTheDocument();
    expect(screen.getByText('没有需要更新的内容')).toBeInTheDocument();
    expect(screen.getByText('记忆蒸馏')).toBeInTheDocument();
    expect(screen.getByText('主动通知')).toBeInTheDocument();
    expect(screen.getByText('失败')).toBeInTheDocument();
    expect(screen.getByText('已跳过')).toBeInTheDocument();
    expect(screen.getByText('子步骤')).toBeInTheDocument();
    expect(screen.queryByText('LLM_TIMEOUT')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '采纳' })).not.toBeInTheDocument();
  });

  it('distinguishes execution load errors from an empty history', async () => {
    vi.mocked(client.listAgentExecutions).mockRejectedValue(new Error('offline'));
    renderAt('/activity');
    expect(await screen.findByRole('alert')).toHaveTextContent('执行记录加载失败');
    expect(screen.queryByText('近 7 天没有执行记录。')).not.toBeInTheDocument();
  });

  it('shows a successful empty execution history', async () => {
    vi.mocked(client.listAgentExecutions).mockResolvedValue([]);
    renderAt('/activity');
    expect(await screen.findByText('近 7 天没有执行记录。')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('per-capability effective cost', () => {
  const perCapability: AgentCapabilityCost[] = [
    { capability: 'headline', costMicros: 600, adopted: 2, costPerAdoptedMicros: 300 },
    { capability: 'draft', costMicros: 100, adopted: 0, costPerAdoptedMicros: null },
  ];

  it('renders cost rows with the amortized per-adopted figure next to the adoption bar', async () => {
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.listAgentExecutions).mockResolvedValue([]);
    vi.mocked(client.listAgentSchedule).mockResolvedValue({ items: [] });
    vi.mocked(client.getAgentMetrics).mockResolvedValue(metrics({ perCapability }));
    renderAt('/activity');

    const region = await waitFor(() => {
      const el = document.querySelector('[data-region="capability-costs"]');
      expect(el).not.toBeNull();
      return el!;
    });
    const headline = region.querySelector('[data-cost-capability="headline"]')!;
    expect(headline.textContent).toContain('看板状态');
    expect(headline.textContent).toContain('已采纳 2 条');
    expect(headline.textContent).toContain('成本 $0.0006');
    expect(headline.textContent).toContain('每条已采纳 $0.0003');

    // adopted = 0 → nothing to amortize over; the dash keeps the column aligned.
    const draft = region.querySelector('[data-cost-capability="draft"]')!;
    expect(draft.textContent).toContain('方案起草');
    expect(draft.textContent).toContain('—');
    expect(draft.textContent).not.toContain('每条已采纳 $');
  });

  it('renders no cost rows when the window has no capability activity', async () => {
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.listAgentExecutions).mockResolvedValue([]);
    vi.mocked(client.listAgentSchedule).mockResolvedValue({ items: [] });
    vi.mocked(client.getAgentMetrics).mockResolvedValue(metrics());
    renderAt('/activity');
    await waitFor(() => {
      expect(client.getAgentMetrics).toHaveBeenCalled();
    });
    expect(document.querySelector('[data-region="capability-costs"]')).toBeNull();
  });
});

describe('schedule visibility', () => {
  beforeEach(() => {
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.listAgentExecutions).mockResolvedValue([]);
    vi.mocked(client.getAgentMetrics).mockResolvedValue(metrics());
    vi.mocked(client.organizeAgentTasks).mockResolvedValue({ status: 'queued', jobId: 'j1' });
    vi.mocked(client.distillAgentMemory).mockResolvedValue({ status: 'queued', jobId: 'j2' });
    vi.mocked(client.cancelAgentSchedule).mockResolvedValue(scheduleItem({ capability: 'memory.distill' }));
  });

  function scheduleFixture(): AgentScheduleItem[] {
    return [
      scheduleItem({
        capability: 'memory.distill',
        status: 'waiting',
        generation: 3,
        processedGeneration: 1,
        pendingCount: 2,
        urgent: true,
        pendingSince: todayIso,
        dueAt: new Date(Date.now() + 3600_000).toISOString(),
        cooldownUntil: null,
        lastSucceededAt: yesterdayIso,
      }),
      scheduleItem({
        capability: 'outcome.cluster',
        status: 'idle',
        lastSucceededAt: yesterdayIso,
      }),
    ];
  }

  it('renders one row per capability with status, pending count and localized times', async () => {
    vi.mocked(client.listAgentSchedule).mockResolvedValue({ items: scheduleFixture() });
    renderAt('/activity');

    const distill = await waitFor(() => {
      const el = document.querySelector('[data-schedule-row="memory.distill"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(distill).toHaveAttribute('data-schedule-status', 'waiting');
    expect(distill.textContent).toContain('记忆蒸馏');
    expect(distill.textContent).toContain(t.settings.activity.schedule.statuses.waiting);
    expect(distill.textContent).toContain('待处理 2');
    expect(distill.textContent).toContain('预计');

    const cluster = document.querySelector('[data-schedule-row="outcome.cluster"]')!;
    expect(cluster).toHaveAttribute('data-schedule-status', 'idle');
    expect(cluster.textContent).toContain('线程聚类');
    expect(cluster.textContent).toContain(t.settings.activity.schedule.statuses.idle);
  });

  it('run-now dispatches through the existing trigger endpoints per capability', async () => {
    vi.mocked(client.listAgentSchedule).mockResolvedValue({ items: scheduleFixture() });
    renderAt('/activity');

    const distill = await waitFor(() => {
      const el = document.querySelector('[data-schedule-row="memory.distill"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(withinRow(distill, t.settings.activity.schedule.runNow));
    await waitFor(() => {
      expect(client.distillAgentMemory).toHaveBeenCalledTimes(1);
    });

    const cluster = document.querySelector('[data-schedule-row="outcome.cluster"]')!;
    fireEvent.click(withinRow(cluster, t.settings.activity.schedule.runNow));
    await waitFor(() => {
      expect(client.organizeAgentTasks).toHaveBeenCalledTimes(1);
    });
  });

  it('cancel calls the cancel endpoint and refreshes the view', async () => {
    let calls = 0;
    const items = scheduleFixture();
    vi.mocked(client.listAgentSchedule).mockImplementation(async () => {
      calls += 1;
      return { items: calls === 1 ? items : items.map((i) => ({ ...i, status: 'idle', pendingCount: 0 })) };
    });
    renderAt('/activity');

    const distill = await waitFor(() => {
      const el = document.querySelector('[data-schedule-row="memory.distill"]');
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(withinRow(distill, t.settings.activity.schedule.cancel));
    await waitFor(() => {
      expect(client.cancelAgentSchedule).toHaveBeenCalledWith('memory.distill');
    });
    await waitFor(() => {
      expect(calls).toBeGreaterThanOrEqual(2);
    });
    const refreshed = document.querySelector('[data-schedule-row="memory.distill"]')!;
    expect(refreshed).toHaveAttribute('data-schedule-status', 'idle');
  });

  it('shows an error state without rows when the schedule query fails', async () => {
    vi.mocked(client.listAgentSchedule).mockRejectedValue(new Error('offline'));
    renderAt('/activity');
    expect(await screen.findByText(t.settings.activity.schedule.error)).toBeInTheDocument();
    expect(document.querySelector('[data-schedule-row]')).toBeNull();
  });
});

function withinRow(row: Element, label: string): HTMLElement {
  const button = [...row.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`button ${label} not found in row`);
  return button;
}
