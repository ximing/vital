import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type Report,
  type ReportListItem,
  type ReportOverview,
  type ReportReview,
  type UserProfile,
} from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { setAuthForTest } from '@/services/auth.service';
import { ReportsWorkspace } from '../../../src/features/reports/ReportsWorkspace';
import { resetReportUi } from '../../../src/features/reports/report-ui.service';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listReports: vi.fn(),
      getCurrentReport: vi.fn(),
      getReportOverview: vi.fn(),
      getReport: vi.fn(),
      getReportReview: vi.fn(),
      getReportEmbeds: vi.fn(),
      patchReport: vi.fn(),
      generateReport: vi.fn(),
      syncHead: vi.fn(),
      completeTask: vi.fn(),
      uncompleteTask: vi.fn(),
      upload: vi.fn(),
      bindUpload: vi.fn(),
      search: vi.fn(),
      listTasks: vi.fn(),
      listInbox: vi.fn(),
      updateOnboarding: vi.fn(),
    },
  };
});

const TZ = 'Asia/Shanghai';

const mockUser: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: '测试',
  timezone: TZ,
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  convertArchiveOnComplete: false,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: {},
  llm: DEFAULT_LLM_SETTINGS,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TASK_ID = '11111111-1111-4111-8111-111111111111';

const dailyBody = [
  '# 2026年9月6日 日报',
  '',
  '## 今日完成',
  '',
  '## 进行中',
  '',
  `[[task:${TASK_ID}]]`,
  '',
  '## 稍后读',
  '',
  '## 记录',
  '',
].join('\n');

function makeReport(over: Partial<Report> & Pick<Report, 'id'>): Report {
  return {
    type: 'daily',
    periodStart: '2026-09-06',
    periodEnd: '2026-09-07',
    title: '2026年9月6日 日报',
    revision: 1,
    snapshotAt: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    bodyMd: dailyBody,
    embeds: {
      tasks: {
        [TASK_ID]: { id: TASK_ID, title: '写纪要', status: 'todo', deletedAt: null },
      },
      inbox: {},
    },
    ...over,
  };
}

function asListItem(report: Report): ReportListItem {
  const { bodyMd: _body, embeds: _embeds, ...item } = report;
  return item;
}

function makeOverview(over: Partial<ReportOverview> = {}): ReportOverview {
  const heatmap = Array.from({ length: 30 }, (_, i) => {
    const date = `2026-09-${String(i + 1).padStart(2, '0')}`;
    return {
      date,
      completed: date === '2026-09-05' ? 2 : 0,
      wrote: date === '2026-09-05',
    };
  });
  return {
    type: 'daily',
    period: { start: '2026-09-06', end: '2026-09-07', label: '2026年9月6日' },
    previousPeriod: { start: '2026-09-05', end: '2026-09-06', label: '2026年9月5日' },
    totals: { completed: 1, wrote: 0, carried: 1, captured: 0, completedDelta: 1, wroteDelta: 0 },
    streaks: { completedDays: 1, wroteDays: 0 },
    heatmap,
    heatmapGrain: 'day',
    recentDone: [{ taskId: TASK_ID, title: '写纪要', completedAt: '2026-09-06T00:01:00.000Z', priority: 1 }],
    byPriority: { 0: 0, 1: 1, 2: 0, 3: 0 },
    byList: [],
    ...over,
  };
}

function makeReview(over: Partial<ReportReview> = {}): ReportReview {
  return {
    reportId: 'r-daily',
    type: 'daily',
    periodStart: '2026-09-06',
    periodEnd: '2026-09-07',
    completed: [],
    carried: [
      {
        taskId: TASK_ID,
        title: '写纪要',
        priority: 1,
        dueAt: null,
        listId: 'inbox-1',
        status: 'todo',
        completedAt: null,
        completionId: null,
        deleted: false,
      },
    ],
    captured: [],
    habitProgress: [],
    ...over,
  };
}

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/reports" element={<ReportsWorkspace />} />
            <Route path="/reports/:id" element={<ReportsWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

describe('reports workspace', () => {
  it('keeps the report editor as the primary reflection canvas', async () => {
    renderAt('/reports');
    expect(await screen.findByRole('main')).toHaveAttribute('data-region', 'reflection-canvas');
    expect(await screen.findByTestId('streak-calendar')).toHaveAttribute('data-context', 'calendar');
    expect(document.querySelector('[data-region="calendar-pane"]')).not.toBeNull();
  });

  const daily = makeReport({ id: 'r-daily' });
  const weekly = makeReport({
    id: 'r-weekly',
    type: 'weekly',
    title: '2026年9月1日 – 9月7日 周报',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-08',
    bodyMd: '# 周报\n\n## 本周完成\n\n## 未完成 / 结转\n\n## 稍后读\n\n## 复盘\n',
    embeds: { tasks: {}, inbox: {} },
  });

  beforeEach(() => {
    resetReportUi();
    setAuthForTest(mockUser);
    vi.mocked(client.getCurrentReport).mockImplementation(async (type) =>
      type === 'weekly' ? weekly : daily,
    );
    vi.mocked(client.getReport).mockImplementation(async (id) =>
      id === weekly.id ? weekly : daily,
    );
    vi.mocked(client.listReports).mockImplementation(async ({ type } = {}) => ({
      items: type === 'weekly' ? [asListItem(weekly)] : [asListItem(daily)],
      nextCursor: null,
    }));
    vi.mocked(client.syncHead).mockResolvedValue({
      tasksMaxUpdatedAt: 't1',
      inboxMaxUpdatedAt: 'i1',
      reportsMaxUpdatedAt: 'r1',
      revision: 1,
    });
    vi.mocked(client.getReportOverview).mockResolvedValue(makeOverview());
    vi.mocked(client.getReportReview).mockResolvedValue(makeReview());
    vi.mocked(client.getReportEmbeds).mockResolvedValue({
      revision: 1,
      embeds: daily.embeds,
    });
    vi.mocked(client.patchReport).mockImplementation(async (id, input) => ({
      ...daily,
      id,
      revision: (input.revision ?? 1) + 1,
      bodyMd: input.bodyMd ?? daily.bodyMd,
      title: input.title ?? daily.title,
    }));
    vi.mocked(client.generateReport).mockResolvedValue({ status: 'queued', jobId: 'job-1' });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listInbox).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.search).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.updateOnboarding).mockResolvedValue({
      ...mockUser,
      onboarding: { wroteDaily: true },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetReportUi();
  });

  it('redirects /reports to the current period editor with stats in the calendar pane', async () => {
    renderAt('/reports');
    await waitFor(() => {
      expect(client.getCurrentReport).toHaveBeenCalledWith('daily');
    });
    expect(await screen.findByDisplayValue(daily.title)).toBeInTheDocument();
    expect(await screen.findByTestId('streak-calendar')).toBeInTheDocument();
    const pane = document.querySelector('[data-region="calendar-pane"]');
    expect(pane?.textContent).toContain(t.reports.completed);
    expect(pane?.textContent).toContain(t.reports.wrote);
  });

  it('opens the period review without leaking heading markers', async () => {
    renderAt('/reports/r-daily');
    expect(await screen.findByDisplayValue(daily.title)).toBeInTheDocument();
    expect(await screen.findByText('写纪要')).toBeInTheDocument();
    expect(screen.getByTestId('report-wysiwyg').textContent).not.toContain('##');
    expect(screen.queryByTestId('report-source')).not.toBeInTheDocument();
    expect(screen.getByTestId('streak-calendar')).toBeInTheDocument();
    expect(document.querySelector('[data-region="calendar-pane"]')).not.toBeNull();
    expect(screen.getByTestId('report-wysiwyg')).toHaveAttribute('data-region', 'report-editor');
    expect(screen.getByTestId('report-wysiwyg')).not.toHaveClass('border', 'border-border');
    expect(screen.getByRole('button', { name: t.reports.image })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.reports.table })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.reports.attach })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.reports.link })).toBeInTheDocument();
  });

  it('opens a past day from the streak calendar', async () => {
    const past = makeReport({
      id: 'r-past',
      periodStart: '2026-09-05',
      periodEnd: '2026-09-06',
      title: '2026年9月5日 日报',
      revision: 2,
    });
    vi.mocked(client.getCurrentReport).mockImplementation(async (type, at) => {
      if (type === 'weekly') return weekly;
      if (at === '2026-09-05') return past;
      return daily;
    });
    vi.mocked(client.getReport).mockImplementation(async (id) => {
      if (id === weekly.id) return weekly;
      if (id === past.id) return past;
      return daily;
    });
    vi.mocked(client.listReports).mockResolvedValue({
      items: [asListItem({ ...daily, revision: 2 }), asListItem(past)],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderAt('/reports');
    expect(await screen.findByTestId('streak-calendar')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `9月5日 · ${t.reports.wrote}` }));
    await waitFor(() => {
      expect(client.getCurrentReport).toHaveBeenCalledWith('daily', '2026-09-05');
    });
    expect(await screen.findByDisplayValue(past.title)).toBeInTheDocument();
    expect(screen.getByTestId('streak-calendar')).toBeInTheDocument();
  });

  it('switches type by redirecting to that type’s current report', async () => {
    renderAt('/reports?type=weekly');
    await waitFor(() => {
      expect(client.getCurrentReport).toHaveBeenCalledWith('weekly');
    });
    expect(await screen.findByDisplayValue(weekly.title)).toBeInTheDocument();
  });

  it('switches period type from the segmented control in the title row', async () => {
    const user = userEvent.setup();
    renderAt('/reports/r-daily');
    expect(await screen.findByDisplayValue(daily.title)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: t.reports.daily })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(screen.getByRole('tab', { name: t.reports.weekly }));
    await waitFor(() => {
      expect(
        vi.mocked(client.getCurrentReport).mock.calls.some((call) => call[0] === 'weekly'),
      ).toBe(true);
    });
    expect(await screen.findByDisplayValue(weekly.title)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: t.reports.weekly })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('shows the period range and inline review stats in the meta row', async () => {
    renderAt('/reports/r-daily');
    expect(await screen.findByDisplayValue(daily.title)).toBeInTheDocument();
    expect(screen.getByText('2026-09-06')).toBeInTheDocument();
    // Inline stats: review counts rendered as Sora numerals next to caption labels.
    const main = screen.getByRole('main');
    expect(main.textContent).toContain(t.reports.carried);
  });

  it('toggles a carried task via complete, not a markdown patch', async () => {
    vi.mocked(client.completeTask).mockResolvedValue({
      task: {
        id: TASK_ID,
        listId: 'inbox-1',
        parentId: null,
        outcomeId: null,
        estimateMinutes: null,
        deferCount: 0,
        delegable: false,
        habitId: null,
        habitSeq: null,
        title: '写纪要',
        notes: '',
        status: 'done',
        priority: 3,
        pinned: false,
        dueAt: null,
        startAt: null,
        reminderMode: null,
        reminderOffsetMinutes: null,
        reminderAt: null,
        isAllDay: true,
        timezone: TZ,
        recurrence: null,
        recurrenceKind: null,
        recurrenceDtstart: null,
        completedAt: '2026-09-06T00:01:00.000Z',
        sortOrder: 1,
        tagIds: [],
        deletedAt: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-06T00:01:00.000Z',
      },
      undo: { completionId: 'comp-1' },
    });
    vi.mocked(client.getReportEmbeds).mockResolvedValue({
      revision: 1,
      embeds: {
        tasks: { [TASK_ID]: { id: TASK_ID, title: '写纪要', status: 'done', deletedAt: null } },
        inbox: {},
      },
    });
    const user = userEvent.setup();
    renderAt('/reports/r-daily');
    const box = await screen.findByRole('checkbox', { name: t.reports.complete });
    await user.click(box);
    await waitFor(() => {
      expect(client.completeTask).toHaveBeenCalledWith(TASK_ID);
    });
    expect(client.patchReport).not.toHaveBeenCalled();
  });

  it('annotates a carried task that was completed after the freeze', async () => {
    vi.mocked(client.getReportReview).mockResolvedValue(
      makeReview({
        carried: [
          {
            taskId: TASK_ID,
            title: '写纪要',
            priority: 1,
            dueAt: null,
            listId: 'inbox-1',
            status: 'done',
            completedAt: '2026-09-07T02:00:00.000Z',
            completionId: 'comp-later',
            deleted: false,
          },
        ],
      }),
    );
    renderAt('/reports/r-daily');
    const row = await screen.findByText('写纪要');
    expect(row).toBeInTheDocument();
    expect(
      screen.getByText(`${t.reports.finishedLater} · 9月7日`),
    ).toBeInTheDocument();
    // Done later: the toggle reflects the live state, still actionable.
    expect(screen.getByRole('checkbox', { name: t.reports.complete })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('marks a carried task that was deleted after the freeze', async () => {
    vi.mocked(client.getReportReview).mockResolvedValue(
      makeReview({
        carried: [
          {
            taskId: TASK_ID,
            title: '写纪要',
            priority: 1,
            dueAt: null,
            listId: 'inbox-1',
            status: 'todo',
            completedAt: null,
            completionId: null,
            deleted: true,
          },
        ],
      }),
    );
    renderAt('/reports/r-daily');
    expect(await screen.findByText('写纪要')).toBeInTheDocument();
    expect(screen.getByText(t.reports.deleted)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: t.reports.complete })).toBeDisabled();
  });

  it('flushes the pending save immediately on Cmd+S', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('/reports/r-daily');
    const title = await screen.findByLabelText(t.reports.title);
    await user.type(title, '改');
    expect(await screen.findByText(t.reports.unsaved)).toBeInTheDocument();
    await user.keyboard('{Meta>}s{/Meta}');
    // Debounce (800ms) never elapsed — the shortcut itself drove the save.
    await waitFor(() => {
      expect(client.patchReport).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(t.reports.saved)).toBeInTheDocument();
  });

  it('shows 409 conflict and does not replace the dirty body', async () => {
    vi.mocked(client.patchReport).mockRejectedValue(
      new ApiError(409, 'REPORT_REVISION_CONFLICT', '报告已被更新，请先同步'),
    );
    const user = userEvent.setup();
    renderAt('/reports/r-daily');
    const title = await screen.findByLabelText(t.reports.title);
    await user.clear(title);
    await user.type(title, '本地标题');
    await waitFor(() => {
      expect(client.patchReport).toHaveBeenCalled();
    });
    expect(await screen.findByText(t.reports.conflict)).toBeInTheDocument();
    expect(screen.getByLabelText(t.reports.title)).toHaveValue('本地标题');
    expect(screen.getByRole('button', { name: t.reports.reload })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.reports.keepLocal })).toBeInTheDocument();
  });

  it.each(['another report', 'own completed save', 'own pending save', 'remote during save'])(
    'checks the document revision for %s while editing',
    async (scenario) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      let finishSave!: (report: Report) => void;
      vi.mocked(client.patchReport).mockImplementation(
        () => new Promise<Report>((resolve) => { finishSave = resolve; }),
      );
      renderAt('/reports/r-daily');
      const title = await screen.findByLabelText(t.reports.title);
      await user.type(title, '改');
      await user.keyboard('{Meta>}s{/Meta}');
      await waitFor(() => expect(client.patchReport).toHaveBeenCalledTimes(1));
      const saved = { ...daily, title: `${daily.title}改`, revision: 2 };
      if (scenario === 'own completed save') {
        await act(async () => finishSave(saved));
        await user.type(title, '继续');
      }
      vi.mocked(client.syncHead).mockResolvedValue({
        tasksMaxUpdatedAt: 't1',
        inboxMaxUpdatedAt: 'i1',
        reportsMaxUpdatedAt: 'r2',
        revision: 2,
      });
      vi.mocked(client.getReportEmbeds).mockResolvedValue({
        revision: scenario === 'another report' ? 1 : scenario === 'remote during save' ? 3 : 2,
        embeds: daily.embeds,
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(screen.queryByText(t.reports.remoteUpdated)).not.toBeInTheDocument();
      if (scenario === 'own pending save' || scenario === 'remote during save') {
        await act(async () => finishSave(saved));
        if (scenario === 'remote during save') {
          expect(screen.getByText(t.reports.remoteUpdated)).toBeInTheDocument();
        } else {
          expect(screen.queryByText(t.reports.remoteUpdated)).not.toBeInTheDocument();
        }
      }
      expect(title).toHaveValue(`${daily.title}改${scenario === 'own completed save' ? '继续' : ''}`);
    },
  );

  it('polls embeds only and never GETs the report body while dirty', async () => {
    vi.mocked(client.patchReport).mockRejectedValue(new Error('offline'));
    vi.mocked(client.getReportEmbeds).mockResolvedValue({ revision: 2, embeds: daily.embeds });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('/reports/r-daily');
    const title = await screen.findByLabelText(t.reports.title);
    await user.type(title, '改');
    vi.mocked(client.syncHead).mockResolvedValue({
      tasksMaxUpdatedAt: 't2',
      inboxMaxUpdatedAt: 'i1',
      reportsMaxUpdatedAt: 'r2',
      revision: 2,
    });
    vi.mocked(client.getReport).mockClear();
    vi.mocked(client.getReportEmbeds).mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    await waitFor(() => {
      expect(client.getReportEmbeds).toHaveBeenCalledWith('r-daily');
    });
    expect(client.getReport).not.toHaveBeenCalled();
    expect(await screen.findByText(t.reports.remoteUpdated)).toBeInTheDocument();
    expect(screen.getByLabelText(t.reports.title)).toHaveValue(`${daily.title}改`);
  });

  it('queues daily report generation from the editor', async () => {
    const generated = makeReport({
      id: 'r-daily',
      revision: 2,
      bodyMd: `${daily.bodyMd}完成了纪要。\n`,
    });
    vi.mocked(client.generateReport).mockImplementation(async () => {
      vi.mocked(client.getReport).mockResolvedValue(generated);
      return { status: 'queued', jobId: 'job-1' };
    });
    const user = userEvent.setup();
    renderAt('/reports/r-daily');
    const button = await screen.findByTestId('report-generate');
    expect(button).toHaveTextContent(t.reports.generate);
    await user.click(button);
    await waitFor(() => {
      expect(client.generateReport).toHaveBeenCalledWith('r-daily');
    });
    await waitFor(() => {
      expect(screen.getByTestId('report-wysiwyg').textContent).toContain('完成了纪要。');
    });
  });

  it('hides one-click generate on weekly reports', async () => {
    renderAt('/reports/r-weekly');
    expect(await screen.findByDisplayValue(weekly.title)).toBeInTheDocument();
    expect(screen.queryByTestId('report-generate')).not.toBeInTheDocument();
  });

  it('shows overview error when stats cannot load', async () => {
    vi.mocked(client.getReportOverview).mockRejectedValue(
      new ApiError(500, 'INTERNAL_ERROR', '服务器内部错误'),
    );
    renderAt('/reports');
    expect(await screen.findAllByText('服务器内部错误')).not.toHaveLength(0);
    expect(screen.getAllByRole('button', { name: t.reports.retry }).length).toBeGreaterThan(0);
  });
});
