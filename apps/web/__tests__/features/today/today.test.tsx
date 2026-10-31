import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type ContinuityIntervention,
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
      listAgentExecutions: vi.fn(),
      listInbox: vi.fn(),
      listLists: vi.fn(),
      listTags: vi.fn(),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      createTaskFromText: vi.fn(),
      patchTask: vi.fn(),
      completeTask: vi.fn(),
      uncompleteTask: vi.fn(),
      tickHabit: vi.fn(),
      deleteTask: vi.fn(),
      reorderTasks: vi.fn(),
      createTag: vi.fn(),
      updateOnboarding: vi.fn(),
      putTodayLayoutContext: vi.fn(() => Promise.resolve({ ok: true as const })),
      listEnergyLogs: vi.fn(() => Promise.resolve({ items: [] })),
      createEnergyLog: vi.fn(),
      listContinuityInterventions: vi.fn(),
      markContinuityInterventionSeen: vi.fn(),
      feedbackContinuityIntervention: vi.fn(),
      listExplorationWindows: vi.fn(),
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
  dailyModelCallLimit: 100,
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
  pinned: false,
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
    pulse: { inboxPending: 3, reportStreak: 4, todayReportId: null, upcomingDay: null },
    now: {
      continuousMinutes: 120,
      quiet: false,
      recommendations: [],
      reason: '今天没有待办，留一点时间给自己。',
    },
    layout: null,
    generatedAt: '2026-09-09T00:00:00.000Z',
    ...over,
  };
}

function makeIntervention(
  over: Partial<ContinuityIntervention> & Pick<ContinuityIntervention, 'id'>,
): ContinuityIntervention {
  return {
    contractId: 'c1',
    outcomeId: 'o-work',
    revision: 1,
    kind: 'stall_adjust',
    factFingerprint: 'fp1',
    status: 'open',
    expiresAt: null,
    actionableUntil: null,
    snoozedUntil: null,
    content: {
      facts: ['没有记录'],
      whyNow: '约定时段没有记录，可以补记、做一次最小行动，或调整约定。',
      primaryAction: { title: '做一次最小行动', durationMin: 20, completionStandard: '' },
      secondaryActions: [],
    },
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
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
            <Route path="/explore/:windowId" element={<div data-testid="explore-page" />} />
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
    vi.mocked(client.listAgentExecutions).mockResolvedValue([]);
    vi.mocked(client.listOutcomes).mockResolvedValue([]);
    vi.mocked(client.listInbox).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listLists).mockResolvedValue({ items: [inboxList] });
    vi.mocked(client.listTags).mockResolvedValue({ items: [] });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.updateOnboarding).mockResolvedValue({
      ...mockUser,
      onboarding: { createdTask: true },
    });
    vi.mocked(client.listContinuityInterventions).mockResolvedValue({ items: [] });
    vi.mocked(client.markContinuityInterventionSeen).mockResolvedValue({} as ContinuityIntervention);
    vi.mocked(client.listExplorationWindows).mockResolvedValue({ items: [] });
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
    // Task list. The priority brief must not repeat an unmarked title.
    const tasksRegion = document.querySelector('[data-region="today-tasks"]');
    expect(tasksRegion).not.toBeNull();
    expect(within(tasksRegion as HTMLElement).getByText('完成项目整理')).toBeInTheDocument();
    expect(document.querySelector('[data-region="today-lead"]')?.textContent ?? '').not.toContain('完成项目整理');
    const compose = screen.getByLabelText(t.todos.quickAddPlaceholder);
    expect(compose.closest('[data-region="today-compose"]')).not.toBeNull();
    expect(compose).toHaveAttribute('placeholder', t.todos.quickAddPlaceholder);
    const shell = compose.closest('.field-shell');
    expect(shell).not.toBeNull();
    expect(shell?.className).not.toMatch(/border-border|shadow-/);
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

  it('keeps an existing headline visible while the agent refresh is pending', async () => {
    const pending = makeOutcome({
      id: 'o-known',
      name: '身体健康',
      agentState: 'pending',
      agentHeadline: '喝水近 7 天全勤',
    });
    vi.mocked(client.getToday).mockResolvedValue(makeDashboard({ outcomes: [pending] }));

    renderToday();

    expect(await screen.findByText('喝水近 7 天全勤')).toBeInTheDocument();
    expect(screen.getByText(t.today.updating)).toBeInTheDocument();
    expect(screen.queryByLabelText(t.today.updating)).not.toBeInTheDocument();
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

  it('hides the continuity notice when there are no interventions', async () => {
    renderToday();
    await screen.findByRole('heading', { name: t.today.title });
    expect(document.querySelector('[data-region="continuity-notice"]')).toBeNull();
    expect(screen.queryByRole('region', { name: t.today.notice.title })).not.toBeInTheDocument();
    expect(document.querySelector('[data-region="exploration-seasonal"]')).toBeNull();
  });

  it('shows a quiet seasonal explore link when an open window exists', async () => {
    vi.mocked(client.listExplorationWindows).mockResolvedValue({
      items: [
        {
          id: 'win-1',
          windowKey: 'holiday:CN:2026-10-01:2026-10-07',
          startDate: '2026-10-01',
          endDate: '2026-10-07',
          timezone: TZ,
          region: 'CN',
          calendarVersion: 'v1',
          status: 'open',
          closedReason: null,
          generatedAt: '2026-09-21T04:00:00.000Z',
        },
      ],
    });
    renderToday();
    const line = await screen.findByText('10月1日–10月7日 有一段空闲，可以看看探索建议');
    expect(line.closest('[data-region="exploration-seasonal"]')).not.toBeNull();
    expect(line.closest('a')).toHaveAttribute('href', '/explore/win-1');
  });

  it('expands the first continuity notice and keeps the rest collapsed', async () => {
    const first = makeIntervention({ id: 'i-1' });
    const second = makeIntervention({
      id: 'i-2',
      content: {
        facts: ['10月20日约定时段没有记录'],
        whyNow: '另一件事也没有记录。',
        primaryAction: { title: '做一次最小行动', durationMin: 10, completionStandard: '' },
        secondaryActions: [],
      },
    });
    vi.mocked(client.listContinuityInterventions).mockResolvedValue({ items: [first, second] });
    vi.mocked(client.markContinuityInterventionSeen).mockResolvedValue(first);

    renderToday();

    const region = await screen.findByRole('region', { name: t.today.notice.title });
    expect(region).toHaveAttribute('data-region', 'continuity-notice');
    expect(within(region).getByText('没有记录')).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: t.today.notice.start })).toHaveAttribute(
      'href',
      '/today/threads/o-work',
    );
    expect(within(region).getByRole('button', { name: t.today.notice.done })).toBeInTheDocument();
    expect(
      within(region).getByRole('button', { name: `${t.today.notice.expand}：另一件事也没有记录。` }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(client.markContinuityInterventionSeen).toHaveBeenCalledWith('i-1');
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
      outcomeId: null,
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

  it('keeps habits on today after today instances are done, including completed ones', async () => {
    vi.mocked(client.listHabits).mockResolvedValue([
      {
        id: 'h-water',
        name: '喝水',
        kind: 'count',
        targetCount: 8,
        windowStart: '08:00',
        windowEnd: '22:00',
        active: true,
        createdBy: 'user',
        sortOrder: 0,
        outcomeId: null,
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
        todayDone: 6,
        todayTotal: 6,
      },
      {
        id: 'h-exercise',
        name: '锻炼',
        kind: 'daily',
        targetCount: null,
        windowStart: null,
        windowEnd: null,
        active: true,
        createdBy: 'user',
        sortOrder: 1,
        outcomeId: null,
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
        todayDone: 1,
        todayTotal: 1,
      },
    ]);
    renderToday();
    expect(await screen.findByText('喝水')).toBeInTheDocument();
    expect(
      screen.getByText(t.settings.habits.todayProgress.replace('{done}', '6').replace('{total}', '8')),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '喝水' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('锻炼')).toBeInTheDocument();
    expect(screen.getByText(t.settings.habits.todayDone)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '锻炼' })).toHaveAttribute('aria-checked', 'true');
  });

  it('checks in a habit when the progress ring is clicked', async () => {
    const user = userEvent.setup();
    const habitTask = makeTask({
      id: 'habit-task',
      title: '喝水',
      habitId: 'h-water',
      habitSeq: 7,
    });
    vi.mocked(client.listHabits).mockResolvedValue([
      {
        id: 'h-water',
        name: '喝水',
        kind: 'count',
        targetCount: 8,
        windowStart: '08:00',
        windowEnd: '22:00',
        active: true,
        createdBy: 'user',
        sortOrder: 0,
        outcomeId: null,
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
        todayDone: 6,
        todayTotal: 7,
      },
    ]);
    vi.mocked(client.listTasks).mockResolvedValue({ items: [habitTask], nextCursor: null });
    vi.mocked(client.getToday).mockResolvedValue(makeDashboard({ tasks: [habitTask] }));
    let release: (value: { task: typeof habitTask; undo: { completionId: string } }) => void = () => {};
    vi.mocked(client.completeTask).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderToday();
    const ring = await screen.findByRole('checkbox', { name: '喝水' });
    await user.click(ring);
    await waitFor(() => {
      expect(ring).toHaveAttribute('aria-busy', 'true');
    });
    expect(ring.querySelector('.animate-spin')).not.toBeNull();
    release({
      task: { ...habitTask, status: 'done' },
      undo: { completionId: 'c1' },
    });
    await waitFor(() => {
      expect(client.completeTask).toHaveBeenCalledWith('habit-task');
    });
    await waitFor(() => {
      expect(ring).not.toHaveAttribute('aria-busy');
    });
    expect(client.tickHabit).not.toHaveBeenCalled();
  });

  it('checks in a habit that has no open instance yet', async () => {
    const user = userEvent.setup();
    const habit = {
      id: 'h-water',
      name: '喝水',
      kind: 'count' as const,
      targetCount: 8,
      windowStart: '08:00',
      windowEnd: '22:00',
      active: true,
      createdBy: 'user' as const,
      sortOrder: 0,
      outcomeId: null,
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:00.000Z',
      todayDone: 0,
      todayTotal: 0,
    };
    vi.mocked(client.listHabits).mockResolvedValue([habit]);
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    let release: (value: typeof habit) => void = () => {};
    vi.mocked(client.tickHabit).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    renderToday();
    const ring = await screen.findByRole('checkbox', { name: '喝水' });
    expect(ring).toBeEnabled();
    await user.click(ring);
    await waitFor(() => {
      expect(ring).toHaveAttribute('aria-busy', 'true');
    });
    expect(ring.querySelector('.animate-spin')).not.toBeNull();
    release({ ...habit, todayDone: 1, todayTotal: 1 });
    await waitFor(() => {
      expect(client.tickHabit).toHaveBeenCalledWith('h-water');
    });
    await waitFor(() => {
      expect(ring).not.toHaveAttribute('aria-busy');
    });
    expect(client.completeTask).not.toHaveBeenCalled();
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
        outcomeId: null,
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

  it('does not leave an empty task band when habits exist but there are no tasks', async () => {
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
        outcomeId: null,
        createdAt: '2026-09-09T00:00:00.000Z',
        updatedAt: '2026-09-09T00:00:00.000Z',
        todayDone: 0,
        todayTotal: 0,
      },
    ]);
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    const { container } = renderToday();
    await screen.findByRole('checkbox', { name: '喝水' });
    expect(container.querySelector('[data-region="tasks-group-divider"]')).toBeNull();
    expect(screen.queryByText(t.empty.today)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: t.todos.quickAddPlaceholder })).toBeInTheDocument();
  });
});

describe('now card', () => {
  beforeEach(() => {
    resetTodosUi();
    setAuthForTest(mockUser);
    // 这个分组断言完整「当下」卡片：强制展开（速览条收起态另有专门用例）。
    localStorage.setItem('vital.today.briefing-open', '1');
    vi.mocked(client.getToday).mockResolvedValue(makeDashboard());
    vi.mocked(client.listHabits).mockResolvedValue([]);
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.listAgentExecutions).mockResolvedValue([]);
    vi.mocked(client.listOutcomes).mockResolvedValue([]);
    vi.mocked(client.listInbox).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listLists).mockResolvedValue({ items: [inboxList] });
    vi.mocked(client.listTags).mockResolvedValue({ items: [] });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.updateOnboarding).mockResolvedValue({
      ...mockUser,
      onboarding: { createdTask: true },
    });
    vi.mocked(client.listContinuityInterventions).mockResolvedValue({ items: [] });
    vi.mocked(client.markContinuityInterventionSeen).mockResolvedValue({} as ContinuityIntervention);
    vi.mocked(client.listExplorationWindows).mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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

describe('today briefing', () => {
  beforeEach(() => {    resetTodosUi();
    setAuthForTest(mockUser);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T04:00:00.000Z'));
    localStorage.clear();
    // 这个分组的断言都针对完整简报网格：默认展开（速览条收起态另有专门用例）。
    localStorage.setItem('vital.today.briefing-open', '1');
    delete window.__VITAL_HOST__;
    vi.mocked(client.getToday).mockResolvedValue(makeDashboard());
    vi.mocked(client.listHabits).mockResolvedValue([]);
    vi.mocked(client.listAgentActions).mockResolvedValue([]);
    vi.mocked(client.listAgentExecutions).mockResolvedValue([]);
    vi.mocked(client.listOutcomes).mockResolvedValue([]);
    vi.mocked(client.listInbox).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.listLists).mockResolvedValue({ items: [inboxList] });
    vi.mocked(client.listTags).mockResolvedValue({ items: [] });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.updateOnboarding).mockResolvedValue({
      ...mockUser,
      onboarding: { createdTask: true },
    });
    vi.mocked(client.listContinuityInterventions).mockResolvedValue({ items: [] });
    vi.mocked(client.markContinuityInterventionSeen).mockResolvedValue({} as ContinuityIntervention);
    vi.mocked(client.listExplorationWindows).mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    delete window.__VITAL_HOST__;
    vi.clearAllMocks();
    resetTodosUi();
  });

  it('leads with today work, weather, clothing, upcoming, and the next holiday', async () => {
    const work = makeOutcome({ id: 'o-work', name: '换工作' });
    const todayTask = makeTask({
      id: 'task-today',
      title: '完成项目整理',
      dueAt: '2026-10-13T00:00:00+08:00',
    });
    const urgent = makeTask({
      id: 'task-urgent',
      title: '回客户',
      priority: 0,
      isAllDay: false,
      dueAt: '2026-10-13T10:00:00.000Z',
    });
    const tomorrow = makeTask({
      id: 'task-tomorrow',
      title: '明天交报告',
      dueAt: '2026-10-14T00:00:00+08:00',
    });
    vi.mocked(client.getToday).mockResolvedValue(
      makeDashboard({ outcomes: [work], tasks: [urgent, todayTask] }),
    );
    vi.mocked(client.listTasks).mockImplementation(async (query) => {
      if (query.listId === 'smart:upcoming') return { items: [urgent, todayTask, tomorrow], nextCursor: null };
      return { items: [urgent, todayTask], nextCursor: null };
    });
    localStorage.setItem(
      'vital.today.place',
      JSON.stringify({ name: '上海', latitude: 31.23, longitude: 121.47 }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('api.open-meteo.com/v1/forecast')) {
          return new Response(
            JSON.stringify({ current: { temperature_2m: 33, weather_code: 0 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );
    window.__VITAL_HOST__ = {
      kind: 'desktop',
      applyChrome() {},
      showStickyAlert() {},
      listenStickyAlerts: async () => () => {},
      closeStickyAlert() {},
      openInMain() {},
      hideMain() {},
      readTodayCalendar: async () => ({
        status: 'ok',
        events: [{ title: '周会', start: '2026-10-13T01:30:00.000Z', allDay: false }],
      }),
    };

    renderToday();

    expect(await screen.findByText('上海 · 晴 33°C')).toBeInTheDocument();
    expect(screen.getByText(t.today.briefing.clothing.hotDry)).toBeInTheDocument();
    expect(screen.getByText(/明天交报告/)).toBeInTheDocument();
    expect(screen.getByText(/元旦/)).toBeInTheDocument();
    expect(screen.getByText(/2027年1月1日/)).toBeInTheDocument();
    expect(screen.queryByText('日程')).not.toBeInTheDocument();
    expect(screen.queryByText(/周会/)).not.toBeInTheDocument();

    const tasksRegion = document.querySelector('[data-region="today-tasks"]');
    const board = document.querySelector('[data-region="outcome-board"]');
    expect(tasksRegion).not.toBeNull();
    expect(board).not.toBeNull();
    expect(
      (tasksRegion as Node).compareDocumentPosition(board as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(tasksRegion as HTMLElement).getByText('完成项目整理')).toBeInTheDocument();
    expect(within(tasksRegion as HTMLElement).getByText('回客户')).toBeInTheDocument();
    expect(document.querySelector('[data-region="now-card"]')?.innerHTML ?? '').not.toContain('text-[34px]');
    const lead = document.querySelector('[data-region="today-lead"]');
    expect(lead?.textContent).toContain('紧急 1');
    expect(lead?.textContent).toContain('回客户');
    expect(lead?.textContent).toContain('18:00');
    expect(lead?.textContent).toContain('还有 1 件在下面');
    expect(lead?.textContent ?? '').not.toContain('完成项目整理');
    expect(lead?.textContent ?? '').not.toContain('今天要做');
    expect(screen.getByText('优先')).toBeInTheDocument();
    expect(screen.getByText('最近')).toBeInTheDocument();
    expect(document.querySelector('[data-region="today-meetings"]')).toBeNull();
  });

  it('drops a stored schedule module and does not ask for calendar permission on the page', async () => {
    vi.mocked(client.getToday).mockResolvedValue(
      makeDashboard({
        layout: {
          modules: [{ id: 'lead' }, { id: 'meetings' }],
          updatedAt: '2026-10-13T00:00:00.000Z',
        } as NonNullable<TodayDashboard['layout']>,
      }),
    );
    window.__VITAL_HOST__ = {
      kind: 'desktop',
      applyChrome() {},
      showStickyAlert() {},
      listenStickyAlerts: async () => () => {},
      closeStickyAlert() {},
      openInMain() {},
      hideMain() {},
      readTodayCalendar: async () => ({ status: 'denied', events: [] }),
      openCalendarSettings: async () => undefined,
    };

    renderToday();

    expect(await screen.findByText('优先')).toBeInTheDocument();
    expect(screen.queryByText('日程')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.today.briefing.meetingsOpenSettings })).not.toBeInTheDocument();
    expect(document.querySelector('[data-module="meetings"]')).toBeNull();
  });

  it('shows an empty-today line and a weather-unavailable line without a clock', async () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });
    renderToday();

    expect(await screen.findByText(t.today.briefing.empty)).toBeInTheDocument();
    expect(await screen.findByText(t.today.briefing.weatherUnavailable)).toBeInTheDocument();
    expect(screen.getByLabelText(t.today.briefing.setPlace)).toBeInTheDocument();
    expect(screen.queryByText(t.today.briefing.meetingsMacOnly)).not.toBeInTheDocument();
    expect(screen.queryByText('日程')).not.toBeInTheDocument();
    expect(screen.getByText(/元旦|春节|清明节|劳动节|端午节|中秋节|国庆节/)).toBeInTheDocument();
    expect(document.querySelector('[data-region="now-card"]')?.innerHTML ?? '').not.toContain('text-[34px]');
    expect(document.querySelectorAll('[data-region="today-module"]').length).toBeGreaterThan(1);
    const tasksRegion = document.querySelector('[data-region="today-tasks"]');
    const board = document.querySelector('[data-region="empty-outcomes"], [data-region="outcome-board"]');
    expect(tasksRegion).not.toBeNull();
    expect(board).not.toBeNull();
    expect(
      (tasksRegion as Node).compareDocumentPosition(board as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows the modules an agent layout names, in that order, and hides the rest', async () => {
    vi.mocked(client.getToday).mockResolvedValue(
      makeDashboard({
        layout: {
          modules: [
            { id: 'holiday' },
            { id: 'lead' },
            { id: 'note', text: '先把逾期的三件收掉' },
          ],
          updatedAt: '2026-10-13T00:00:00.000Z',
        },
      }),
    );
    renderToday();

    expect(await screen.findByText('先把逾期的三件收掉')).toBeInTheDocument();
    const order = [...document.querySelectorAll('[data-module]')].map((node) =>
      node.getAttribute('data-module'),
    );
    expect(order).toEqual(['holiday', 'lead', 'note']);
    expect(document.querySelector('[data-module="weather"]')).toBeNull();
    expect(document.querySelector('[data-module="focus"]')).toBeNull();
    const holiday = document.querySelector('[data-module="holiday"]');
    const lead = document.querySelector('[data-module="lead"]');
    expect(holiday).not.toBeNull();
    expect(lead).not.toBeNull();
    expect(
      (holiday as Node).compareDocumentPosition(lead as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('collapses the briefing into a glance strip by default and persists the toggle', async () => {
    localStorage.removeItem('vital.today.briefing-open');
    const urgent = makeTask({
      id: 'task-urgent',
      title: '回客户',
      priority: 0,
      isAllDay: false,
      dueAt: '2026-10-13T10:00:00.000Z',
    });
    vi.mocked(client.getToday).mockResolvedValue(
      makeDashboard({
        tasks: [urgent],
        now: {
          continuousMinutes: 95,
          quiet: false,
          reason: '14:00 前有一整块时间。',
          recommendations: [
            {
              taskId: 'task-urgent',
              title: '回客户',
              outcomeId: null,
              estimateMinutes: 30,
              dueSoon: true,
              dueAt: '2026-10-13T10:00:00.000Z',
            },
          ],
        },
      }),
    );
    vi.mocked(client.listTasks).mockResolvedValue({ items: [urgent], nextCursor: null });

    renderToday();

    // 速览条：优先计数 chip、节假日 chip、第一条推荐；不渲染模块网格。
    expect(await screen.findByText(t.today.glance.title)).toBeInTheDocument();
    expect(document.querySelector('[data-region="now-card"]')?.getAttribute('data-collapsed')).toBe(
      'true',
    );
    expect(screen.getByText('紧急 1')).toBeInTheDocument();
    expect(screen.getByText(/元旦/)).toBeInTheDocument();
    expect(
      document.querySelector('[data-region="now-recommendation"]')?.textContent,
    ).toContain('回客户');
    expect(document.querySelector('[data-region="today-module"]')).toBeNull();

    // 展开恢复完整简报网格，并把选择写进 localStorage。
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.today.glance.expand) }));
    expect(localStorage.getItem('vital.today.briefing-open')).toBe('1');
    expect(await screen.findByText('优先')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-region="today-module"]').length).toBeGreaterThan(0);

    // 再收起。
    await userEvent.click(screen.getByRole('button', { name: new RegExp(t.today.glance.collapse) }));
    expect(localStorage.getItem('vital.today.briefing-open')).toBe('0');
    expect(document.querySelector('[data-region="now-card"]')?.getAttribute('data-collapsed')).toBe(
      'true',
    );
  });
});
