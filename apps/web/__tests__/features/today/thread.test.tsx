import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type AgentActionLogItem,
  type List,
  type Outcome,
  type OutcomeDetail,
  type Task,
  type UserProfile,
} from '@vital/dto';
import { ApiError } from '@vital/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { setAuthForTest } from '@/services/auth.service';
import { ThreadWorkspace } from '../../../src/features/today/ThreadWorkspace';
import { resetTodosUi } from '../../../src/features/todos/todos-ui.service';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      getOutcomeDetail: vi.fn(),
      listOutcomes: vi.fn(),
      patchOutcome: vi.fn(),
      closeOutcome: vi.fn(),
      reopenOutcome: vi.fn(),
      undoOutcome: vi.fn(),
      refreshOutcome: vi.fn(),
      listInbox: vi.fn(),
      patchInbox: vi.fn(),
      listLists: vi.fn(),
      listTags: vi.fn(),
      listTasks: vi.fn(),
      createTask: vi.fn(),
      patchTask: vi.fn(),
      completeTask: vi.fn(),
      uncompleteTask: vi.fn(),
      deleteTask: vi.fn(),
      createTag: vi.fn(),
      updateOnboarding: vi.fn(),
    },
  };
});

const TZ = 'Asia/Shanghai';
const OUTCOME_ID = '11111111-1111-4111-8111-111111111111';

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
    outcomeId: OUTCOME_ID,
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

function makeAction(
  over: Partial<AgentActionLogItem> & Pick<AgentActionLogItem, 'id'>,
): AgentActionLogItem {
  return {
    actionType: 'outcome.suggestion',
    targetType: 'outcome',
    targetId: OUTCOME_ID,
    payload: {},
    feedback: 'pending',
    feedbackPayload: null,
    feedbackAt: null,
    createdAt: '2026-09-10T01:20:00.000Z',
    targetName: '换工作',
    payloadSummary: '',
    ...over,
  };
}

function makeDetail(over: Partial<OutcomeDetail> = {}): OutcomeDetail {
  return {
    outcome: makeOutcome({ id: OUTCOME_ID, name: '换工作' }),
    tasks: [],
    materials: [],
    agentActions: [],
    ...over,
  };
}

function renderThread(id: string = OUTCOME_ID) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/today/threads/${id}`]}>
          <Routes>
            <Route path="/today" element={<div data-testid="today-page" />} />
            <Route path="/today/threads/:id" element={<ThreadWorkspace />} />
            <Route path="/inbox/:id" element={<div data-testid="inbox-reader" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

describe('thread workspace', () => {
  beforeEach(() => {
    resetTodosUi();
    setAuthForTest(mockUser);
    vi.mocked(client.getOutcomeDetail).mockResolvedValue(makeDetail());
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

  it('renders header, next step, grouped tasks, materials and the agent timeline', async () => {
    vi.mocked(client.getOutcomeDetail).mockResolvedValue(
      makeDetail({
        outcome: makeOutcome({
          id: OUTCOME_ID,
          name: '换工作',
          ruleSignal: 'alert',
          agentHeadline: '本周已推进两步，简历还差最后一轮校对。',
          openTaskCount: 1,
        }),
        tasks: [
          makeTask({ id: 't-open', title: '简历最后一轮校对', estimateMinutes: 40 }),
          makeTask({
            id: 't-done',
            title: '整理项目经历',
            status: 'done',
            completedAt: '2026-09-09T02:00:00.000Z',
          }),
        ],
        materials: [
          {
            id: 'm-1',
            title: '简历反馈要点',
            excerpt: null,
            siteName: null,
            source: 'manual',
            status: 'unread',
            capturedAt: '2026-09-10T01:05:00.000Z',
          },
        ],
        agentActions: [
          makeAction({
            id: 'a-1',
            actionType: 'outcome.create',
            feedback: 'edited',
            payloadSummary: '换工作',
            createdAt: '2026-09-10T01:40:00.000Z',
          }),
          makeAction({
            id: 'a-2',
            actionType: 'task.decompose',
            targetType: 'task',
            targetId: 't-open',
            targetName: '简历最后一轮校对',
            feedback: 'pending',
            payloadSummary: '校对、回复内推',
            createdAt: '2026-09-10T01:20:00.000Z',
          }),
        ],
      }),
    );

    renderThread();

    expect(await screen.findByRole('heading', { name: '换工作' })).toBeInTheDocument();
    expect(screen.getByText(t.today.signal.alert)).toBeInTheDocument();
    expect(screen.getByText('本周已推进两步，简历还差最后一轮校对。')).toBeInTheDocument();
    // Next step card points at the first open task.
    expect(screen.getByText(t.thread.nextStep)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.thread.viewTask })).toBeInTheDocument();
    // Tasks grouped open/done.
    expect(screen.getByText(t.thread.openGroup.replace('{n}', '1'))).toBeInTheDocument();
    expect(screen.getByText(t.thread.doneGroup.replace('{n}', '1'))).toBeInTheDocument();
    expect(screen.getByText('整理项目经历')).toBeInTheDocument();
    // Materials.
    expect(screen.getByText('简历反馈要点')).toBeInTheDocument();
    // Agent timeline: labels per feedback.
    expect(screen.getByText(t.thread.agentLog)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t.thread.feedback.edited))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t.thread.feedback.pending))).toBeInTheDocument();
    expect(screen.getByText('校对、回复内推')).toBeInTheDocument();
  });

  it('renames the thread inline', async () => {
    const user = userEvent.setup();
    vi.mocked(client.patchOutcome).mockImplementation(async (id, input) =>
      makeOutcome({ id, name: input.name ?? '换工作' }),
    );
    renderThread();

    await user.click(await screen.findByRole('button', { name: t.thread.rename }));
    const input = screen.getByDisplayValue('换工作');
    await user.clear(input);
    await user.type(input, '换到 AI 公司');
    await user.click(screen.getByRole('button', { name: t.thread.save }));

    await waitFor(() => {
      expect(client.patchOutcome).toHaveBeenCalledWith(OUTCOME_ID, { name: '换到 AI 公司' });
    });
  });

  it('closes the thread after a confirmation', async () => {
    const user = userEvent.setup();
    vi.mocked(client.closeOutcome).mockImplementation(async (id) =>
      makeOutcome({ id, name: '换工作', status: 'closed' }),
    );
    renderThread();

    await user.click(await screen.findByRole('button', { name: t.thread.closeThread }));
    expect(screen.getByText(t.thread.closeConfirmTitle)).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: t.thread.closeThread }),
    );

    await waitFor(() => {
      expect(client.closeOutcome).toHaveBeenCalledWith(OUTCOME_ID);
    });
  });

  it('undoes an agent-created thread inside the undo window', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getOutcomeDetail).mockResolvedValue(
      makeDetail({
        outcome: makeOutcome({
          id: OUTCOME_ID,
          name: '学英语',
          createdBy: 'agent',
          undoUntil: new Date(Date.now() + 60_000).toISOString(),
        }),
      }),
    );
    vi.mocked(client.undoOutcome).mockResolvedValue(undefined);
    renderThread();

    await user.click(await screen.findByRole('button', { name: t.today.undo }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: t.thread.undoConfirm }),
    );

    await waitFor(() => {
      expect(client.undoOutcome).toHaveBeenCalledWith(OUTCOME_ID);
    });
    // Undoing dissolves the thread — back to today.
    expect(await screen.findByTestId('today-page')).toBeInTheDocument();
  });

  it('detaches a material back to the inbox', async () => {
    const user = userEvent.setup();
    vi.mocked(client.getOutcomeDetail).mockResolvedValue(
      makeDetail({
        materials: [
          {
            id: 'm-1',
            title: '目标岗位 JD',
            excerpt: null,
            siteName: null,
            source: 'web',
            status: 'unread',
            capturedAt: '2026-09-09T08:20:00.000Z',
          },
        ],
      }),
    );
    vi.mocked(client.patchInbox).mockResolvedValue({} as never);
    renderThread();

    await user.click(await screen.findByRole('button', { name: t.thread.detach }));
    await waitFor(() => {
      expect(client.patchInbox).toHaveBeenCalledWith('m-1', { outcomeId: null });
    });
  });

  it('creates a task attached to the current thread', async () => {
    const user = userEvent.setup();
    vi.mocked(client.createTask).mockImplementation(async (input) =>
      makeTask({ id: 't-new', title: input.title, estimateMinutes: input.estimateMinutes ?? null }),
    );
    renderThread();

    const tasksSection = await screen.findByRole('region', {
      name: t.thread.tasksSection,
    });
    await user.click(within(tasksSection).getByRole('button', { name: t.thread.newTask }));
    await user.type(screen.getByLabelText(t.thread.newTaskPlaceholder), '回复内推消息');
    await user.type(screen.getByLabelText(t.thread.estimatePlaceholder), '10');
    await user.click(screen.getByRole('button', { name: t.thread.addTask }));

    await waitFor(() => {
      expect(client.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '回复内推消息',
          outcomeId: OUTCOME_ID,
          estimateMinutes: 10,
        }),
      );
    });
  });

  it('shows the not-found state for a missing thread', async () => {
    vi.mocked(client.getOutcomeDetail).mockRejectedValue(
      new ApiError(404, 'NOT_FOUND', 'not found'),
    );
    renderThread('22222222-2222-4222-8222-222222222222');

    expect(await screen.findByText(t.thread.notFoundTitle)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t.thread.backToday })).toHaveAttribute(
      'href',
      '/today',
    );
  });

  it('shows the retry state when loading fails', async () => {
    vi.mocked(client.getOutcomeDetail).mockRejectedValue(new Error('network down'));
    renderThread();

    expect(await screen.findByText(t.thread.loadFailedTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.today.retry })).toBeInTheDocument();
  });
});
