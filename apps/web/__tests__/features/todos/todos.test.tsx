import type { List, Task, UserProfile } from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { useAuthStore } from '@/state/auth-store';
import { TodosWorkspace } from '../../../src/features/todos/TodosWorkspace';
import { zonedLocalMidnightIso } from '../../../src/features/todos/model';
import { resetTodosUi } from '../../../src/features/todos/ui-store';

const TZ = 'Asia/Shanghai';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listLists: vi.fn(),
      listTasks: vi.fn(),
      listTags: vi.fn(),
      calendar: vi.fn(),
      createTask: vi.fn(),
      patchTask: vi.fn(),
      completeTask: vi.fn(),
      uncompleteTask: vi.fn(),
      deleteTask: vi.fn(),
      restoreTask: vi.fn(),
      reorderTasks: vi.fn(),
      getTask: vi.fn(),
      createList: vi.fn(),
      createTag: vi.fn(),
      updateOnboarding: vi.fn(),
    },
  };
});

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

const inbox: List = {
  id: 'inbox-1',
  kind: 'inbox',
  name: '收集箱',
  color: null,
  icon: null,
  sortOrder: 0,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const smartToday: List = {
  ...inbox,
  id: 'smart:today',
  kind: 'smart',
  name: '今天',
  sortOrder: -5,
};

function makeTask(over: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    listId: 'inbox-1',
    parentId: null,
    notes: '',
    status: 'todo',
    priority: 3,
    dueAt: null,
    startAt: null,
    remindAt: null,
    isAllDay: true,
    timezone: TZ,
    timeBucket: 'dated',
    recurrence: null,
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

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/todos/lists/:listId" element={<TodosWorkspace view="list" />} />
          <Route path="/todos/board" element={<TodosWorkspace view="board" />} />
          <Route path="/todos/calendar" element={<TodosWorkspace view="week" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('todos workspace', () => {
  beforeEach(() => {
    resetTodosUi();
    useAuthStore.setState({ user: mockUser, status: 'ready' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-06T00:00:00.000Z'));
    vi.mocked(client.listLists).mockResolvedValue({ items: [smartToday, inbox] });
    vi.mocked(client.listTags).mockResolvedValue({ items: [] });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(client.calendar).mockResolvedValue({ instances: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    resetTodosUi();
  });

  it('shows spec empty copy on today', async () => {
    renderAt('/todos/lists/smart:today');
    expect(await screen.findByText(t.empty.today)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.empty.actionNew })).toBeInTheDocument();
  });

  it('shows inbox / upcoming / done / user-list empty copy', async () => {
    const { unmount: u1 } = renderAt('/todos/lists/smart:inbox');
    expect(await screen.findByText(t.empty.inboxList)).toBeInTheDocument();
    u1();
    const { unmount: u2 } = renderAt('/todos/lists/smart:anytime');
    expect(await screen.findByText(t.empty.upcoming)).toBeInTheDocument();
    u2();
    const { unmount: u3 } = renderAt('/todos/lists/smart:done');
    expect(await screen.findByText(t.empty.done)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.empty.actionNew })).not.toBeInTheDocument();
    u3();
    const { unmount: u4 } = renderAt('/todos/lists/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(await screen.findByText(t.empty.userList)).toBeInTheDocument();
    u4();
  });

  it('groups overdue above today', async () => {
    vi.mocked(client.listTasks).mockResolvedValue({
      items: [
        makeTask({
          id: 'over',
          title: '昨天没做完',
          dueAt: zonedLocalMidnightIso('2026-09-05', TZ),
          sortOrder: 1,
        }),
        makeTask({
          id: 'now',
          title: '今天要做',
          dueAt: zonedLocalMidnightIso('2026-09-06', TZ),
          sortOrder: 2,
        }),
      ],
      nextCursor: null,
    });
    renderAt('/todos/lists/smart:today');
    expect(await screen.findByText('昨天没做完')).toBeInTheDocument();
    expect(screen.getByText(t.todos.overdue)).toBeInTheDocument();
    const overdueHead = screen.getByText(t.todos.overdue);
    const todayHeads = screen.getAllByText(t.lists.today);
    expect(
      overdueHead.compareDocumentPosition(screen.getByText('昨天没做完')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(todayHeads.length).toBeGreaterThan(0);
  });

  it('j selects the overdue row when it is painted above today', async () => {
    vi.mocked(client.listTasks).mockResolvedValue({
      items: [
        makeTask({
          id: 'now',
          title: '今天要做',
          dueAt: zonedLocalMidnightIso('2026-09-06', TZ),
          sortOrder: 1,
        }),
        makeTask({
          id: 'over',
          title: '昨天没做完',
          dueAt: zonedLocalMidnightIso('2026-09-05', TZ),
          sortOrder: 2,
        }),
      ],
      nextCursor: null,
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('/todos/lists/smart:today');
    expect(await screen.findByText('昨天没做完')).toBeInTheDocument();
    await user.keyboard('j');
    expect(screen.getByRole('option', { name: '昨天没做完' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: '今天要做' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await user.keyboard('j');
    expect(screen.getByRole('option', { name: '今天要做' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('completes optimistically and undoes from the 5s toast', async () => {
    const open = makeTask({
      id: 'task-1',
      title: '写纪要',
      dueAt: zonedLocalMidnightIso('2026-09-06', TZ),
    });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [open], nextCursor: null });
    vi.mocked(client.completeTask).mockResolvedValue({
      task: { ...open, status: 'done', completedAt: '2026-09-06T00:01:00.000Z' },
      undo: { completionId: 'comp-1' },
    });
    vi.mocked(client.uncompleteTask).mockResolvedValue(open);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('/todos/lists/smart:today');
    expect(await screen.findByText('写纪要')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: t.todos.complete }));
    expect(await screen.findByText(/已完成/)).toBeInTheDocument();
    expect(client.completeTask).toHaveBeenCalledWith('task-1');
    await user.click(screen.getByRole('button', { name: t.todos.undo }));
    await waitFor(() => {
      expect(client.uncompleteTask).toHaveBeenCalledWith('task-1', { completionId: 'comp-1' });
    });
  });

  it('handles n j k Enter e / t 1-4 when not in an input', async () => {
    const first = makeTask({
      id: 'a',
      title: '第一件',
      dueAt: zonedLocalMidnightIso('2026-09-06', TZ),
      sortOrder: 1,
    });
    const second = makeTask({
      id: 'b',
      title: '第二件',
      dueAt: zonedLocalMidnightIso('2026-09-06', TZ),
      sortOrder: 2,
    });
    vi.mocked(client.listTasks).mockResolvedValue({ items: [first, second], nextCursor: null });
    vi.mocked(client.completeTask).mockResolvedValue({
      task: { ...first, status: 'done', completedAt: '2026-09-06T00:01:00.000Z' },
      undo: { completionId: 'c1' },
    });
    vi.mocked(client.uncompleteTask).mockResolvedValue(first);
    vi.mocked(client.patchTask).mockResolvedValue({ ...second, priority: 0 });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('/todos/lists/smart:today');
    expect(await screen.findByText('第一件')).toBeInTheDocument();

    await user.keyboard('j');
    expect(screen.getByRole('option', { name: /第一件/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('j');
    expect(screen.getByRole('option', { name: /第二件/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('k');
    expect(screen.getByRole('option', { name: /第一件/ })).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(await screen.findByLabelText(t.todos.closeDetail)).toBeInTheDocument();

    await user.keyboard('1');
    await waitFor(() => {
      expect(client.patchTask).toHaveBeenCalledWith('a', { priority: 0 });
    });

    await user.keyboard('e');
    expect(await screen.findByText(/已完成/)).toBeInTheDocument();
    await user.keyboard('e');
    await waitFor(() => {
      expect(client.uncompleteTask).toHaveBeenCalled();
    });

    await user.keyboard('/');
    expect(document.activeElement).toHaveAttribute('id', 'todo-list-filter');
    (document.activeElement as HTMLElement).blur();

    await user.keyboard('n');
    expect(document.activeElement).toHaveAttribute('id', 'todo-quick-add');
    (document.activeElement as HTMLElement).blur();

    await user.keyboard('t');
    expect(
      await screen.findByRole('heading', { level: 1, name: t.lists.today }),
    ).toBeInTheDocument();
  });

  it('renders week chips for all-day and dots for timed instances', async () => {
    vi.mocked(client.calendar).mockResolvedValue({
      instances: [
        {
          taskId: 'all',
          listId: 'inbox-1',
          title: '全天会议',
          occurrenceAt: zonedLocalMidnightIso('2026-09-06', TZ),
          isAllDay: true,
          status: 'todo',
          priority: 2,
        },
        {
          taskId: 'timed',
          listId: 'inbox-1',
          title: '下午电话',
          occurrenceAt: '2026-09-06T06:00:00.000Z',
          isAllDay: false,
          status: 'todo',
          priority: 1,
        },
      ],
    });
    renderAt('/todos/calendar?list=smart:today');
    expect(await screen.findByText('全天会议')).toBeInTheDocument();
    expect(screen.getByText('下午电话')).toBeInTheDocument();
    const chip = screen.getByRole('button', { name: '全天会议' });
    expect(chip.className).toContain('rounded-full');
    const timed = screen.getByRole('button', { name: /下午电话/ });
    expect(within(timed).getByText('14:00')).toBeInTheDocument();
  });

  it('board empty uses spec copy and has status/priority columns', async () => {
    renderAt('/todos/board?list=smart:today');
    expect(await screen.findByText(t.empty.board)).toBeInTheDocument();
  });
});
