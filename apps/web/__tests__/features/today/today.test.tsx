import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type List,
  type LlmSettingsPublic,
  type Outcome,
  type Task,
  type TodayDashboard,
  type UserProfile,
} from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { setAuthForTest } from '@/services/auth.service';
import { TodayWorkspace } from '../../../src/features/today/TodayWorkspace';
import { resetTodosUi } from '../../../src/features/todos/todos-ui.service';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      getToday: vi.fn(),
      listOutcomes: vi.fn(),
      createOutcome: vi.fn(),
      patchOutcome: vi.fn(),
      undoOutcome: vi.fn(),
      refreshOutcome: vi.fn(),
      listHabits: vi.fn(),
      createHabit: vi.fn(),
      listAgentActions: vi.fn(),
      listInbox: vi.fn(),
      listLists: vi.fn(),
      listTags: vi.fn(),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      createTaskFromText: vi.fn(),
      patchTask: vi.fn(),
      completeTask: vi.fn(),
      uncompleteTask: vi.fn(),
      deleteTask: vi.fn(),
      reorderTasks: vi.fn(),
      createTag: vi.fn(),
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

const llmConfigured: LlmSettingsPublic = {
  providers: [
    {
      id: 'p1',
      providerId: 'openai',
      label: 'OpenAI',
      baseUrl: null,
      models: ['gpt-5-mini'],
      apiKeySet: true,
    },
  ],
  routing: { default: { providerId: 'p1', model: 'gpt-5-mini' } },
};

const inboxList: List = {
  id: 'inbox-1',
  kind: 'inbox',
  name: '收集箱',
  color: null,
  icon: null,
  iconAttachmentId: null,
  iconUrl: null,
  parentId: null,
  sortOrder: 0,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function makeTask(over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    listId: 'inbox-1',
    parentId: null,
    outcomeId: null,
    estimateMinutes: null,
    deferCount: 0,
    delegable: false,
    habitId: null,
    habitSeq: null,
    notes: '',
    status: 'todo',
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
    completedAt: null,
    sortOrder: 1024,
    tagIds: [],
    deletedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function makeOutcome(over: Partial<Outcome> & Pick<Outcome, 'id' | 'name'>): Outcome {
  return {
    status: 'open',
    createdBy: 'user',
    ruleSignal: 'flat',
    ruleNextStep: null,
    agentHeadline: null,
    agentSuggestion: null,
    agentState: 'idle',
    agentUpdatedAt: null,
    undoUntil: null,
    lastActivityAt: null,
    sortOrder: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    openTaskCount: 0,
    completedLast7d: 0,
    materialCount: 0,
    ...over,
  };
}

function makeDashboard(over: Partial<TodayDashboard> = {}): TodayDashboard {
  return {
    outcomes: [],
    tasks: [],
    pulse: { inboxPending: 3, reportStreak: 4, todayReportId: null },
    now: {
      continuousMinutes: 120,
      quiet: false,
      recommendations: [],
      reason: '今天没有待办，留一点时间给自己。',
    },
    generatedAt: '2026-09-09T00:00:00.000Z',
    ...over,
  };
}

function renderToday() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/today']}>
          <Routes>
            <Route path="/today" element={<TodayWorkspace />} />
            <Route path="/today/threads/:id" element={<ThreadStub />} />
            <Route path="/inbox" element={<div />} />
            <Route path="/reports" element={<div />} />
            <Route path="/settings" element={<div />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

function ThreadStub() {
  return <div data-testid="thread-page">thread:{useParams().id}</div>;
}

describe('today workspace', () => {
  beforeEach(() => {
    resetTodosUi();
    setAuthForTest(mockUser);
    vi.mocked(client.getToday).mockResolvedValue(makeDashboard());
    vi.mocked(client.listHabits).mockResolvedValue([]);
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.listOutcomes).mockResolvedValue([]);
    vi.mocked(client.listInbox).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listLists).mockResolvedValue({ items: [inboxList] });
    vi.mocked(client.listTags).mockResolvedValue({ items: [] });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.updateOnboarding).mockResolvedValue({
      ...mockUser,
      onboarding: { createdTask: true },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetTodosUi();
  });

  it('renders the outcome board, pulse strip and today tasks', async () => {
    const work = makeOutcome({
      id: 'o-work',
      name: '换工作',
      ruleSignal: 'up',
      agentHeadline: '本周完成 3 件事，节奏不错。',
      openTaskCount: 3,
      materialCount: 2,
    });
    const home = makeOutcome({
      id: 'o-home',
      name: '家庭',
      ruleSignal: 'alert',
      ruleNextStep: '宝宝百天宴场地',
      openTaskCount: 1,
    });
    const task = makeTask({ id: 'task-1', title: '完成项目整理', outcomeId: 'o-work' });
    vi.mocked(client.getToday).mockResolvedValue(
      makeDashboard({ outcomes: [work, home], tasks: [task] }),
    );
    vi.mocked(client.listTasks).mockResolvedValue({ items: [task], nextCursor: null });

    renderToday();

    expect(await screen.findByText('换工作')).toBeInTheDocument();
    expect(screen.getByText('↑ 在推进')).toBeInTheDocument();
    expect(screen.getByText('本周完成 3 件事，节奏不错。')).toBeInTheDocument();
    expect(screen.getByText('! 需要决定')).toBeInTheDocument();
    expect(screen.getByText('宝宝百天宴场地')).toBeInTheDocument();
    expect(screen.getByText('3 件事')).toBeInTheDocument();
    expect(screen.getByText('2 条资料')).toBeInTheDocument();
    // Pulse strip
    expect(screen.getByText('条待处理收集')).toBeInTheDocument();
    expect(screen.getByText(t.today.pulseReportTodo)).toBeInTheDocument();
    // Task list
    expect(screen.getByText('完成项目整理')).toBeInTheDocument();
  });

  it('marks fresh agent-created outcomes and undoes them', async () => {
    const agentOutcome = makeOutcome({
      id: 'o-agent',
      name: '学英语',
      createdBy: 'agent',
      undoUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    vi.mocked(client.getToday).mockResolvedValue(makeDashboard({ outcomes: [agentOutcome] }));
    vi.mocked(client.undoOutcome).mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderToday();

    const card = (await screen.findByText('学英语')).closest('[data-region="outcome-card"]');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText(/系统新建/)).toBeInTheDocument();

    await user.click(within(card as HTMLElement).getByRole('button', { name: t.today.undo }));
    await waitFor(() => {
      expect(client.undoOutcome).toHaveBeenCalledWith('o-agent');
    });
  });

  it('hides the undo affordance once the window has passed', async () => {
    const stale = makeOutcome({
      id: 'o-old',
      name: '旧线程',
      createdBy: 'agent',
      undoUntil: new Date(Date.now() - 60_000).toISOString(),
    });
    vi.mocked(client.getToday).mockResolvedValue(makeDashboard({ outcomes: [stale] }));

    renderToday();

    expect(await screen.findByText('旧线程')).toBeInTheDocument();
    expect(screen.queryByText(/系统新建/)).not.toBeInTheDocument();
  });

  it('shows a skeleton while the agent is pending and retries when failed', async () => {
    const pending = makeOutcome({ id: 'o-p', name: '健身', agentState: 'pending' });
    const failed = makeOutcome({ id: 'o-f', name: '读书', agentState: 'failed' });
    vi.mocked(client.getToday).mockResolvedValue(makeDashboard({ outcomes: [pending, failed] }));
    vi.mocked(client.refreshOutcome).mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderToday();

    expect(await screen.findByText('健身')).toBeInTheDocument();
    expect(screen.getAllByLabelText(t.today.updating).length).toBe(1);
    expect(screen.getByText(t.today.updating)).toBeInTheDocument();

    const card = screen.getByText('读书').closest('[data-region="outcome-card"]');
    await user.click(
      within(card as HTMLElement).getByRole('button', { name: `⟳ ${t.today.retry}` }),
    );
    await waitFor(() => {
      expect(client.refreshOutcome).toHaveBeenCalledWith('o-f');
    });
  });

  it('guides thread creation when the board is empty', async () => {
    vi.mocked(client.createOutcome).mockImplementation(async (input) =>
      makeOutcome({ id: 'o-new', name: input.name }),
    );

    const user = userEvent.setup();
    renderToday();

    expect(await screen.findByText(t.today.emptyTitle)).toBeInTheDocument();
    await user.type(screen.getByLabelText(t.today.newOutcome), '深入研究Agent相关知识');
    await user.click(screen.getByRole('button', { name: t.today.create }));
    await waitFor(() => {
      expect(client.createOutcome).toHaveBeenCalledWith({ name: '深入研究Agent相关知识' });
    });
  });

  it('shows the LLM setup banner until an agent model is configured', async () => {
    renderToday();
    expect(await screen.findByText(t.today.llmBanner)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.today.llmBannerGo })).toHaveAttribute(
      'href',
      '/settings?tab=llm',
    );
  });

  it('hides the banner when the headline capability is routed', async () => {
    setAuthForTest({ ...mockUser, llm: llmConfigured });
    renderToday();
    await screen.findByRole('heading', { name: t.today.title });
    await waitFor(() => {
      expect(screen.queryByText(t.today.llmBanner)).not.toBeInTheDocument();
    });
  });

  it('navigates to the thread detail page when a card is clicked', async () => {
    const work = makeOutcome({ id: 'o-work', name: '换工作' });
    const taskA = makeTask({ id: 'task-a', title: '改简历', outcomeId: 'o-work' });
    const taskB = makeTask({ id: 'task-b', title: '回复 Alex' });
    vi.mocked(client.getToday).mockResolvedValue(
      makeDashboard({ outcomes: [work], tasks: [taskA, taskB] }),
    );
    vi.mocked(client.listTasks).mockResolvedValue({ items: [taskA, taskB], nextCursor: null });

    const user = userEvent.setup();
    renderToday();

    expect(await screen.findByText('改简历')).toBeInTheDocument();
    expect(screen.getByText('回复 Alex')).toBeInTheDocument();

    await user.click(screen.getByText('换工作'));

    // Thread cards only navigate — the today task list is never filtered.
    expect(await screen.findByTestId('thread-page')).toHaveTextContent('thread:o-work');
  });

  it('offers one-click habit templates when no habit is active', async () => {
    const user = userEvent.setup();
    renderToday();

    expect(await screen.findByText(t.today.habitEmptyTitle)).toBeInTheDocument();
    const card = screen.getByText(t.today.habitEmptyTitle).closest('[data-region="habit-empty"]');
    expect(card).not.toBeNull();

    vi.mocked(client.createHabit).mockResolvedValue({
      id: 'h1',
      name: t.today.habitTemplateWater,
      kind: 'count',
      targetCount: 8,
      windowStart: '08:00',
      windowEnd: '22:00',
      active: true,
      createdBy: 'user',
      sortOrder: 0,
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:00.000Z',
      todayDone: 0,
      todayTotal: 0,
    });
    await user.click(
      within(card as HTMLElement).getByRole('button', { name: t.today.habitTemplateWater }),
    );
    await waitFor(() => {
      expect(client.createHabit).toHaveBeenCalledWith({
        name: t.today.habitTemplateWater,
        kind: 'count',
        targetCount: 8,
        windowStart: '08:00',
        windowEnd: '22:00',
      });
    });
  });

  it('hides the habit empty card once a habit is active', async () => {
    vi.mocked(client.listHabits).mockResolvedValue([
      {
        id: 'h1',
        name: '喝水',
        kind: 'count',
        targetCount: 8,
        windowStart: '08:00',
        windowEnd: '22:00',
        active: true,
        createdBy: 'user',
        sortOrder: 0,
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
        todayDone: 0,
        todayTotal: 0,
      },
    ]);
    renderToday();
    await screen.findByRole('heading', { name: t.today.title });
    await waitFor(() => {
      expect(screen.queryByText(t.today.habitEmptyTitle)).not.toBeInTheDocument();
    });
  });
});

describe('now card', () => {
  beforeEach(() => {
    resetTodosUi();
    setAuthForTest(mockUser);
    vi.mocked(client.getToday).mockResolvedValue(makeDashboard());
    vi.mocked(client.listHabits).mockResolvedValue([]);
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.listOutcomes).mockResolvedValue([]);
    vi.mocked(client.listInbox).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listLists).mockResolvedValue({ items: [inboxList] });
    vi.mocked(client.listTags).mockResolvedValue({ items: [] });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.updateOnboarding).mockResolvedValue({
      ...mockUser,
      onboarding: { createdTask: true },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetTodosUi();
  });

  async function nowCard(): Promise<HTMLElement> {
    return (await screen.findByLabelText(t.today.now.title)) as HTMLElement;
  }

  it('renders continuous minutes, reason and recommendations, and opens the task detail on click', async () => {
    const work = makeOutcome({ id: 'o-work', name: '换工作' });
    const taskA = makeTask({
      id: 'task-a',
      title: '简历最后一轮校对',
      outcomeId: 'o-work',
      estimateMinutes: 40,
    });
    vi.mocked(client.getToday).mockResolvedValue(
      makeDashboard({
        outcomes: [work],
        tasks: [taskA],
        now: {
          continuousMinutes: 50,
          quiet: false,
          reason: '接下来约 50 分钟，任选一件开始。',
          recommendations: [
            {
              taskId: 'task-a',
              title: '简历最后一轮校对',
              estimateMinutes: 40,
              outcomeId: 'o-work',
              dueAt: null,
              dueSoon: true,
            },
            {
              taskId: 'task-b',
              title: '回复内推消息',
              estimateMinutes: null,
              outcomeId: 'o-work',
              dueAt: null,
              dueSoon: false,
            },
          ],
        },
      }),
    );
    vi.mocked(client.listTasks).mockResolvedValue({ items: [taskA], nextCursor: null });

    const user = userEvent.setup();
    renderToday();

    const card = await nowCard();
    expect(
      await within(card).findByText(t.today.now.next.replace('{m}', '50')),
    ).toBeInTheDocument();
    expect(within(card).getByText('接下来约 50 分钟，任选一件开始。')).toBeInTheDocument();
    const rec = within(card).getByRole('button', { name: /简历最后一轮校对/ });
    expect(rec).toHaveTextContent('40 分钟');
    expect(rec).toHaveTextContent('换工作');
    expect(rec).toHaveTextContent(t.today.now.dueSoon);
    expect(within(card).getByRole('button', { name: /回复内推消息/ })).toHaveTextContent(
      t.today.now.noEstimate,
    );

    await user.click(rec);
    expect(
      await screen.findByLabelText('简历最后一轮校对', { selector: '[data-region="detail"]' }),
    ).toBeInTheDocument();
  });

  it('rotates the recommendations when 换一个 is clicked', async () => {
    const taskA = makeTask({ id: 'task-a', title: '甲任务' });
    const taskB = makeTask({ id: 'task-b', title: '乙任务' });
    vi.mocked(client.getToday).mockResolvedValue(
      makeDashboard({
        tasks: [taskA, taskB],
        now: {
          continuousMinutes: 50,
          quiet: false,
          reason: '接下来约 50 分钟，任选一件开始。',
          recommendations: [
            {
              taskId: 'task-a',
              title: '甲任务',
              estimateMinutes: 40,
              outcomeId: null,
              dueAt: null,
              dueSoon: false,
            },
            {
              taskId: 'task-b',
              title: '乙任务',
              estimateMinutes: 10,
              outcomeId: null,
              dueAt: null,
              dueSoon: false,
            },
          ],
        },
      }),
    );
    vi.mocked(client.listTasks).mockResolvedValue({ items: [taskA, taskB], nextCursor: null });

    const user = userEvent.setup();
    renderToday();

    const card = await nowCard();
    await within(card).findByRole('button', { name: /甲任务/ });
    const recButtons = () =>
      within(card)
        .getAllByRole('button')
        .filter((b) => b.getAttribute('data-region') === 'now-recommendation');
    expect(recButtons()[0]).toHaveTextContent('甲任务');
    expect(recButtons()[1]).toHaveTextContent('乙任务');

    await user.click(within(card).getByRole('button', { name: t.today.now.swap }));
    expect(recButtons()[0]).toHaveTextContent('乙任务');
    expect(recButtons()[1]).toHaveTextContent('甲任务');
  });

  it('shows the quiet-hours state without recommendations and disables 换一个', async () => {
    vi.mocked(client.getToday).mockResolvedValue(
      makeDashboard({
        now: {
          continuousMinutes: 0,
          quiet: true,
          recommendations: [],
          reason: '现在是静默时段，先休息。明天 07:00 后再来看看。',
        },
      }),
    );

    renderToday();

    const card = await nowCard();
    expect(
      await within(card).findByText('现在是静默时段，先休息。明天 07:00 后再来看看。'),
    ).toBeInTheDocument();
    expect(within(card).getByText(t.today.now.quietLabel)).toBeInTheDocument();
    expect(within(card).queryByText(/接下来约/)).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: t.today.now.swap })).toBeDisabled();
  });

  it('shows the no-tasks state without recommendations', async () => {
    renderToday();

    const card = await nowCard();
    expect(
      await within(card).findByText('今天没有待办，留一点时间给自己。'),
    ).toBeInTheDocument();
    expect(within(card).getByText(t.today.now.next.replace('{m}', '120'))).toBeInTheDocument();
    expect(within(card).queryAllByRole('button', { name: /任务/ })).toEqual([]);
  });
});
