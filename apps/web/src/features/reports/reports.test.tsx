import type { Report, ReportListItem, UserProfile } from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { useAuthStore } from '@/state/auth-store';
import { SAVE_DEBOUNCE_MS } from './model';
import { ReportsWorkspace } from './ReportsWorkspace';
import { resetReportUi } from './ui-store';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listReports: vi.fn(),
      getCurrentReport: vi.fn(),
      getReport: vi.fn(),
      getReportEmbeds: vi.fn(),
      patchReport: vi.fn(),
      fillReport: vi.fn(),
      syncHead: vi.fn(),
      completeTask: vi.fn(),
      uncompleteTask: vi.fn(),
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
  onboarding: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const INBOX_ID = '22222222-2222-4222-8222-222222222222';

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

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reports" element={<ReportsWorkspace />} />
          <Route path="/reports/:id" element={<ReportsWorkspace />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('reports workspace', () => {
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
    useAuthStore.setState({ user: mockUser, status: 'ready' });
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
    vi.mocked(client.fillReport).mockResolvedValue({
      ...daily,
      revision: 2,
      bodyMd: `${daily.bodyMd}[[inbox:${INBOX_ID}]]\n`,
      embeds: {
        ...daily.embeds,
        inbox: { [INBOX_ID]: { id: INBOX_ID, title: '一篇', status: 'unread', deletedAt: null } },
      },
    });
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

  it('opens current daily and keeps ## out of WYSIWYG', async () => {
    renderAt('/reports');
    expect(await screen.findByDisplayValue(daily.title)).toBeInTheDocument();
    expect(await screen.findByText('今日完成')).toBeInTheDocument();
    expect(screen.queryByTestId('report-source')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-wysiwyg').textContent).not.toContain('##');
    expect(screen.getByRole('checkbox', { name: t.reports.complete })).toBeInTheDocument();
    expect(screen.getByText('写纪要')).toBeInTheDocument();
  });

  it('toggles source mode with the button and ⌘/', async () => {
    const user = userEvent.setup();
    renderAt('/reports/r-daily');
    expect(await screen.findByTestId('report-wysiwyg')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.reports.sourceToggle }));
    const source = await screen.findByTestId('report-source');
    expect((source as HTMLTextAreaElement).value).toContain('## 今日完成');
    expect(screen.queryByTestId('report-wysiwyg')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: '/', metaKey: true });
    expect(await screen.findByTestId('report-wysiwyg')).toBeInTheDocument();
    expect(screen.queryByTestId('report-source')).not.toBeInTheDocument();
  });

  it('switches day/week/month/year via current get-or-create', async () => {
    const user = userEvent.setup();
    renderAt('/reports/r-daily');
    expect(await screen.findByDisplayValue(daily.title)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: t.reports.weekly }));
    await waitFor(() => {
      expect(client.getCurrentReport).toHaveBeenCalledWith('weekly');
    });
    expect(await screen.findByDisplayValue(weekly.title)).toBeInTheDocument();
  });

  it('fills the period and applies the returned body', async () => {
    const user = userEvent.setup();
    renderAt('/reports/r-daily');
    expect(await screen.findByText('写纪要')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.reports.fill }));
    await waitFor(() => {
      expect(client.fillReport).toHaveBeenCalledWith(
        'r-daily',
        expect.objectContaining({ revision: expect.any(Number) }),
      );
    });
    expect(await screen.findByText('一篇')).toBeInTheDocument();
  });

  it('fill after a dirty edit PATCHes first, fills with the bumped revision, and cancels autosave', async () => {
    vi.mocked(client.fillReport).mockImplementation(async (id, input) => ({
      ...daily,
      id,
      revision: input.revision + 1,
      title: '本地标题',
      bodyMd: `${daily.bodyMd}[[inbox:${INBOX_ID}]]\n`,
      embeds: {
        ...daily.embeds,
        inbox: { [INBOX_ID]: { id: INBOX_ID, title: '一篇', status: 'unread', deletedAt: null } },
      },
    }));
    const user = userEvent.setup();
    renderAt('/reports/r-daily');
    const title = await screen.findByLabelText(t.reports.title);
    fireEvent.change(title, { target: { value: '本地标题' } });
    await user.click(screen.getByRole('button', { name: t.reports.fill }));
    await waitFor(() => {
      expect(client.patchReport).toHaveBeenCalledWith(
        'r-daily',
        expect.objectContaining({ revision: 1, title: '本地标题' }),
      );
    });
    await waitFor(() => {
      expect(client.fillReport).toHaveBeenCalledWith('r-daily', { revision: 2 });
    });
    expect(await screen.findByText('一篇')).toBeInTheDocument();
    expect(screen.queryByText(t.reports.conflict)).not.toBeInTheDocument();
    await new Promise((resolve) => {
      window.setTimeout(resolve, SAVE_DEBOUNCE_MS + 50);
    });
    expect(client.patchReport).toHaveBeenCalledTimes(1);
  });

  it('toggles a task chip via complete, not a markdown patch', async () => {
    vi.mocked(client.completeTask).mockResolvedValue({
      task: {
        id: TASK_ID,
        listId: 'inbox-1',
        parentId: null,
        title: '写纪要',
        notes: '',
        status: 'done',
        priority: 3,
        dueAt: null,
        startAt: null,
        remindAt: null,
        isAllDay: true,
        timezone: TZ,
        timeBucket: 'dated',
        recurrence: null,
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

  it('polls embeds only and never GETs the report body while dirty', async () => {
    vi.mocked(client.patchReport).mockImplementation(() => new Promise(() => undefined));
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

  it('shows list empty copy when current cannot be opened', async () => {
    vi.mocked(client.getCurrentReport).mockRejectedValue(
      new ApiError(500, 'INTERNAL_ERROR', '服务器内部错误'),
    );
    vi.mocked(client.listReports).mockResolvedValue({ items: [], nextCursor: null });
    renderAt('/reports');
    expect(await screen.findByText(t.empty.reports)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.empty.actionDaily })).toBeInTheDocument();
  });
});
