import {
  DEFAULT_LLM_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  type List,
  type Task,
  type UserProfile,
} from '@vital/dto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { t } from '@/copy';
import { setAuthForTest } from '@/services/auth.service';
import { QuickCreateOverlay } from '../../../src/features/todos/QuickCreateOverlay';
import {
  OPEN_QUICK_CREATE_EVENT,
  quickCreateTask,
} from '../../../src/features/todos/quick-create';
import { emptyScheduleDraft, type ScheduleDraft } from '../../../src/features/todos/schedule-draft';
import { resetTodosUi } from '../../../src/features/todos/todos-ui.service';
import { RabRoot } from '../../helpers/rab-root';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    client: {
      listLists: vi.fn(),
      createTask: vi.fn(),
      createTaskFromText: vi.fn(),
      patchTask: vi.fn(),
      updateOnboarding: vi.fn(),
    },
  };
});

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

const mockUser: UserProfile = {
  id: 'u1',
  email: 'a@b.c',
  displayName: '测试',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  themePreference: 'system',
  weekStartsOn: 1,
  dailyModelCallLimit: 100,
  convertArchiveOnComplete: false,
  notifications: DEFAULT_NOTIFICATION_PREFS,
  onboarding: { createdTask: true },
  llm: {
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
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const createdTask = { id: 'task-new', title: '买牛奶', similarOpenTasks: [] } as unknown as Task;

function renderOverlay() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <RabRoot>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <QuickCreateOverlay />
        </MemoryRouter>
      </QueryClientProvider>
    </RabRoot>,
  );
}

describe('quickCreateTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.createTask).mockResolvedValue(createdTask);
    vi.mocked(client.createTaskFromText).mockResolvedValue(createdTask);
    vi.mocked(client.patchTask).mockResolvedValue(createdTask);
  });

  const pinned: ScheduleDraft = {
    ...emptyScheduleDraft(),
    mode: 'range',
    startYmd: '2026-10-30',
    endYmd: '2026-10-30',
    startHm: '09:00',
    endHm: '09:15',
  };

  it('parses one-liners with the today smart list as the date fallback', async () => {
    await quickCreateTask({
      name: '明天下午三点开会',
      draft: emptyScheduleDraft(),
      extras: { listId: '' },
      inboxId: 'inbox-1',
      timeZone: 'Asia/Shanghai',
      intent: true,
    });
    expect(client.createTaskFromText).toHaveBeenCalledWith({
      text: '明天下午三点开会',
      listId: 'inbox-1',
      timezone: 'Asia/Shanghai',
      smartListId: 'smart:today',
    });
    expect(client.patchTask).not.toHaveBeenCalled();
  });

  it('pins the dragged interval after the AI parse and leaves reminder fields alone', async () => {
    await quickCreateTask({
      name: '高优 明天下午三点开会',
      draft: pinned,
      extras: { listId: '' },
      inboxId: 'inbox-1',
      timeZone: 'Asia/Shanghai',
      intent: true,
      pinSchedule: true,
    });
    expect(client.createTaskFromText).toHaveBeenCalledWith({
      text: '高优 明天下午三点开会',
      listId: 'inbox-1',
      timezone: 'Asia/Shanghai',
      smartListId: 'smart:today',
    });
    expect(client.patchTask).toHaveBeenCalledWith('task-new', {
      startAt: new Date('2026-10-30T09:00:00+08:00').toISOString(),
      dueAt: new Date('2026-10-30T09:15:00+08:00').toISOString(),
      isAllDay: false,
    });
    expect(client.createTask).not.toHaveBeenCalled();
  });

  it('writes the pinned interval into a plain create when no model is used', async () => {
    await quickCreateTask({
      name: '买牛奶',
      draft: pinned,
      extras: { listId: '' },
      inboxId: 'inbox-1',
      timeZone: 'Asia/Shanghai',
      intent: false,
      pinSchedule: true,
    });
    expect(client.createTask).toHaveBeenCalledWith({
      title: '买牛奶',
      listId: 'inbox-1',
      timezone: 'Asia/Shanghai',
      isAllDay: false,
      startAt: new Date('2026-10-30T09:00:00+08:00').toISOString(),
      dueAt: new Date('2026-10-30T09:15:00+08:00').toISOString(),
    });
    expect(client.createTaskFromText).not.toHaveBeenCalled();
    expect(client.patchTask).not.toHaveBeenCalled();
  });

  it('creates a plain task into the inbox without a date', async () => {
    await quickCreateTask({
      name: '买牛奶',
      draft: emptyScheduleDraft(),
      extras: { listId: '' },
      inboxId: 'inbox-1',
      timeZone: 'Asia/Shanghai',
      intent: false,
    });
    expect(client.createTask).toHaveBeenCalledWith({
      title: '买牛奶',
      listId: 'inbox-1',
      timezone: 'Asia/Shanghai',
    });
  });

  it('honors a picked list over the inbox default', async () => {
    await quickCreateTask({
      name: '买牛奶',
      draft: emptyScheduleDraft(),
      extras: { listId: 'list-work' },
      inboxId: 'inbox-1',
      timeZone: 'Asia/Shanghai',
      intent: false,
    });
    expect(client.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ listId: 'list-work' }),
    );
  });
});

describe('quick create overlay', () => {
  beforeEach(() => {
    resetTodosUi();
    setAuthForTest(mockUser);
    vi.mocked(client.listLists).mockResolvedValue({ items: [inboxList] });
    vi.mocked(client.createTask).mockResolvedValue(createdTask);
    vi.mocked(client.createTaskFromText).mockResolvedValue(createdTask);
    vi.mocked(client.updateOnboarding).mockResolvedValue(mockUser);
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetTodosUi();
  });

  /** 列表查询回来前输入框是 disabled 的，userEvent 对禁用控件会卡住——先等它可用。 */
  async function readyInput(): Promise<HTMLElement> {
    const input = await screen.findByLabelText(t.todos.quickAddPlaceholder);
    await waitFor(() => expect(input).toBeEnabled());
    return input;
  }

  it('opens on the global event, submits through the AI parse, then closes', async () => {
    const user = userEvent.setup();
    renderOverlay();
    fireEvent(window, new CustomEvent(OPEN_QUICK_CREATE_EVENT));
    await screen.findByRole('dialog', { name: t.todos.quickCreate.title });

    await user.type(await readyInput(), '明天下午三点开会{Enter}');
    await waitFor(() =>
      expect(client.createTaskFromText).toHaveBeenCalledWith(
        expect.objectContaining({ text: '明天下午三点开会', listId: 'inbox-1' }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument(),
    );
  });

  it('closes on Escape and on backdrop mousedown', async () => {
    renderOverlay();
    fireEvent(window, new CustomEvent(OPEN_QUICK_CREATE_EVENT));
    await screen.findByRole('dialog', { name: t.todos.quickCreate.title });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument();

    fireEvent(window, new CustomEvent(OPEN_QUICK_CREATE_EVENT));
    const dialog = await screen.findByRole('dialog', { name: t.todos.quickCreate.title });
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole('dialog', { name: t.todos.quickCreate.title })).not.toBeInTheDocument();
  });

  it('falls back to a plain create when no model is configured', async () => {
    setAuthForTest({ ...mockUser, llm: DEFAULT_LLM_SETTINGS });
    const user = userEvent.setup();
    renderOverlay();
    fireEvent(window, new CustomEvent(OPEN_QUICK_CREATE_EVENT));
    await screen.findByRole('dialog', { name: t.todos.quickCreate.title });

    await user.type(await readyInput(), '买牛奶{Enter}');
    await waitFor(() =>
      expect(client.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: '买牛奶', listId: 'inbox-1' }),
      ),
    );
    expect(client.createTaskFromText).not.toHaveBeenCalled();
  });
});
